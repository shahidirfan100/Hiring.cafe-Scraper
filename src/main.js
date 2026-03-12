import { Actor, log } from 'apify';
import { PlaywrightCrawler } from 'crawlee';
import { firefox } from 'playwright';

const BASE_URL = 'https://hiring.cafe';
const SEARCH_ENDPOINT = `${BASE_URL}/api/search-jobs`;
const COUNT_ENDPOINT = `${BASE_URL}/api/search-jobs/get-total-count`;

const DEFAULT_RESULTS_WANTED = 20;
const DEFAULT_MAX_PAGES = 10;
const DEFAULT_PAGE_SIZE = 40;
const DEFAULT_DATE_FETCHED_PAST_DAYS = 61;

// CONFIGURATION
const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:147.0) Gecko/20100101 Firefox/147.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 15.7; rv:147.0) Gecko/20100101 Firefox/147.0',
    'Mozilla/5.0 (X11; Linux x86_64; rv:147.0) Gecko/20100101 Firefox/147.0',
];
const getRandomUserAgent = () => USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

const toText = (value) => {
    if (value === null || value === undefined) return null;
    const text = String(value).replace(/\s+/g, ' ').trim();
    return text || null;
};

const toHtml = (value) => {
    if (value === null || value === undefined) return null;
    const html = String(value).trim();
    return html || null;
};

const pruneEmptyFields = (record) => Object.fromEntries(
    Object.entries(record).filter(([, value]) => {
        if (value === null || value === undefined) return false;
        if (typeof value === 'string') return value.trim().length > 0;
        return true;
    }),
);

const ALLOWED_DESCRIPTION_TAGS = new Set([
    'p',
    'br',
    'strong',
    'em',
    'ul',
    'ol',
    'li',
    'h2',
    'h3',
    'h4',
    'blockquote',
    'code',
    'pre',
]);

const sanitizeDescriptionHtml = (value) => {
    const rawHtml = toHtml(value);
    if (!rawHtml) return null;

    let sanitized = rawHtml
        .replace(/\u00a0/g, ' ')
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/<(script|style|noscript|iframe|object|embed|svg|math|canvas|template)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<\s*\/?\s*(html|head|body|meta|link|title)\b[^>]*>/gi, ' ')
        .replace(/<\s*(\/?)\s*div\b[^>]*>/gi, (_match, isClosing) => (isClosing ? '</p>' : '<p>'))
        .replace(/<\s*(\/?)\s*b\b[^>]*>/gi, (_match, isClosing) => (isClosing ? '</strong>' : '<strong>'))
        .replace(/<\s*(\/?)\s*i\b[^>]*>/gi, (_match, isClosing) => (isClosing ? '</em>' : '<em>'))
        .replace(/<\s*br\b[^>]*>/gi, '<br>')
        .replace(/<\s*\/?\s*(span|font)\b[^>]*>/gi, '');

    sanitized = sanitized.replace(/<\/?\s*([a-zA-Z0-9:-]+)(?:\s[^>]*)?>/g, (tagMarkup, tagName) => {
        const tag = String(tagName).toLowerCase();
        if (!ALLOWED_DESCRIPTION_TAGS.has(tag)) return '';
        if (tagMarkup.startsWith('</')) return `</${tag}>`;
        return tag === 'br' ? '<br>' : `<${tag}>`;
    });

    sanitized = sanitized
        .replace(/(<br>\s*){3,}/gi, '<br><br>')
        .replace(/<p>\s*(?=<(h2|h3|h4|ul|ol|li|blockquote|pre|p)>)/gi, '')
        .replace(/<\/(h2|h3|h4|ul|ol|li|blockquote|pre|p)>\s*<\/p>/gi, '</$1>')
        .replace(/<(p|li|h2|h3|h4|strong|em|ul|ol|blockquote|code|pre)>\s*<\/\1>/gi, '')
        .trim();

    return toHtml(sanitized);
};

const toNumber = (value, fallback) => {
    const parsed = Number.parseInt(String(value), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const toAbsoluteUrl = (value) => {
    const text = toText(value);
    if (!text) return null;

    try {
        const url = new URL(text, BASE_URL);
        if (!['http:', 'https:'].includes(url.protocol)) return null;
        return url.href;
    } catch {
        return null;
    }
};

const stripHtml = (htmlText) => {
    const text = toText(htmlText);
    if (!text) return null;
    return toText(text.replace(/<[^>]*>/g, ' '));
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const isBlockedText = (text) => /just a moment|security checkpoint|verif(y|ying).{0,30}(human|browser)|performing security verification|enable javascript to continue|access denied|captcha|cloudflare/i.test(text || '');
const encodeLegacySearchState = (searchState) => Buffer.from(
    encodeURIComponent(JSON.stringify(searchState)),
    'utf8',
).toString('base64');

const createSearchState = ({ keyword, location, workplaceType }) => {
    const normalizedLocation = toText(location);
    const workplaceTypes = workplaceType === 'Any' ? ['Remote', 'Hybrid', 'Onsite'] : [workplaceType];

    const searchState = {
        locations: [],
        workplaceTypes,
        defaultToUserLocation: false,
        userLocation: null,
        searchQuery: keyword || '',
        dateFetchedPastNDays: DEFAULT_DATE_FETCHED_PAST_DAYS,
    };

    if (normalizedLocation?.toLowerCase() === 'united states') {
        searchState.locations = [{
            formatted_address: 'United States',
            types: ['country'],
            geometry: {
                location: {
                    lat: '39.8283',
                    lon: '-98.5795',
                },
            },
            id: 'user_country',
            address_components: [{
                long_name: 'United States',
                short_name: 'US',
                types: ['country'],
            }],
            options: {
                flexible_regions: ['anywhere_in_continent', 'anywhere_in_world'],
            },
        }];
    }

    return searchState;
};

const extractJobsArray = (responseBody) => {
    if (!responseBody) return [];
    if (Array.isArray(responseBody)) return responseBody;

    if (Array.isArray(responseBody.results)) return responseBody.results;
    if (Array.isArray(responseBody.jobs)) return responseBody.jobs;
    if (Array.isArray(responseBody.items)) return responseBody.items;
    if (Array.isArray(responseBody.data)) return responseBody.data;
    if (Array.isArray(responseBody.content)) return responseBody.content;
    if (Array.isArray(responseBody.hits?.hits)) {
        return responseBody.hits.hits.map((hit) => hit?._source || hit).filter(Boolean);
    }
    if (Array.isArray(responseBody.data?.items)) return responseBody.data.items;
    if (Array.isArray(responseBody.data?.results)) return responseBody.data.results;

    return [];
};

const getCompensationText = (job) => {
    const processed = job?.v5_processed_job_data || {};
    const direct = toText(
        job?.compensation ||
        job?.salary ||
        job?.salaryText ||
        job?.compensationText ||
        job?.payRange ||
        processed?.listed_compensation,
    );
    if (direct) return direct;

    const min = processed?.yearly_min_compensation ?? job?.compensationLowEnd ?? job?.minCompensation ?? null;
    const max = processed?.yearly_max_compensation ?? job?.compensationHighEnd ?? job?.maxCompensation ?? null;
    const currency = processed?.listed_compensation_currency ?? job?.compensationCurrency ?? job?.currency ?? '';
    const frequency = processed?.listed_compensation_frequency ?? job?.compensationFrequency ?? job?.frequency ?? '';

    if (min !== null || max !== null) {
        const left = min !== null ? String(min) : '';
        const right = max !== null ? String(max) : '';
        const range = [left, right].filter(Boolean).join(' - ');
        return toText([currency, range, frequency].filter(Boolean).join(' '));
    }

    return null;
};

const humanizeCompanyToken = (value) => {
    const token = toText(value);
    if (!token) return null;

    const normalized = token
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (!normalized) return null;

    return normalized
        .split(' ')
        .map((part) => part ? `${part[0].toUpperCase()}${part.slice(1)}` : '')
        .join(' ');
};

const getCompanyNameFromWebsite = (websiteValue) => {
    const website = toText(websiteValue);
    if (!website) return null;

    try {
        const url = new URL(website.startsWith('http') ? website : `https://${website}`);
        const labels = url.hostname.toLowerCase().split('.').filter(Boolean);
        if (labels.length === 0) return null;

        let token = labels.length > 1 ? labels[labels.length - 2] : labels[0];
        if (['co', 'com', 'org', 'net', 'gov', 'edu'].includes(token) && labels.length > 2) {
            token = labels[labels.length - 3];
        }

        return humanizeCompanyToken(token);
    } catch {
        return null;
    }
};

const getCompanyName = (job, jobInfo = {}, processed = {}) => {
    return toText(
        jobInfo?.company_info?.name ||
        jobInfo?.companyInfo?.name ||
        jobInfo?.company_name ||
        jobInfo?.companyName ||
        jobInfo?.company ||
        processed?.company_name ||
        processed?.company ||
        job?.v5_processed_company_data?.name ||
        job?.v5_processed_company_data?.company_name ||
        job?.companyName ||
        job?.company_name ||
        job?.company?.name ||
        job?.organization?.name ||
        job?.employer?.name ||
        job?.employerName ||
        getCompanyNameFromWebsite(job?.v5_processed_company_data?.website) ||
        getCompanyNameFromWebsite(job?.website) ||
        job?.company,
    );
};

const normalizeJob = (rawJob) => {
    const job = rawJob || {};
    const jobInfo = job?.job_information || {};
    const processed = job?.v5_processed_job_data || {};
    const jobId = toText(job.id || job.jobId || job._id || job.uuid || job.slug);
    const commitment = Array.isArray(processed?.commitment) ? processed.commitment.join(', ') : processed?.commitment;
    const descriptionHtml = sanitizeDescriptionHtml(
        jobInfo.description || job.description || job.descriptionHtml || job.jobDescription || job.requirements,
    );

    const item = {
        job_id: toText(jobId),
        title: toText(jobInfo.title || job.title || job.jobTitle || job.position || job.role || job.name),
        company: toText(getCompanyName(job, jobInfo, processed)),
        location: toText(
            processed?.formatted_workplace_location ||
            job.location ||
            job.locationName ||
            job.city ||
            job.region ||
            job.country ||
            job.workLocation,
        ),
        workplace_type: toText(processed?.workplace_type || job.workplaceType || job.workplace_type || job.workplace?.type),
        commitment_type: toText(
            commitment ||
            job.commitmentType ||
            job.commitment_type ||
            job.employmentType ||
            job.jobType,
        ),
        compensation: toText(getCompensationText(job)),
        date_posted: toText(
            processed?.estimated_publish_date ||
            job.datePosted ||
            job.postedAt ||
            job.publishedAt ||
            job.createdAt ||
            job.dateFetched,
        ),
        description_html: descriptionHtml,
        description_text: toText(stripHtml(descriptionHtml)),
        url: toAbsoluteUrl(
            job.apply_url ||
            job.url ||
            job.jobUrl ||
            job.applicationUrl ||
            job.applyUrl ||
            job.externalUrl,
        ),
    };

    if (!item.url && item.job_id) item.url = `${BASE_URL}/jobs/${encodeURIComponent(item.job_id)}`;

    return pruneEmptyFields(item);
};

const normalizeForMatch = (value) => toText(value)?.toLowerCase() || null;

const matchesOutputFilters = ({ item, keyword, location, workplaceType }) => {
    const normalizedKeyword = normalizeForMatch(keyword);
    if (normalizedKeyword) {
        const haystack = normalizeForMatch([
            item.title,
            item.company,
            item.description_text,
            item.description_html,
            item.commitment_type,
            item.location,
        ].filter(Boolean).join(' '));
        if (!haystack || !haystack.includes(normalizedKeyword)) return false;
    }

    if (workplaceType && workplaceType !== 'Any') {
        const workplace = normalizeForMatch(item.workplace_type);
        if (!workplace || !workplace.includes(workplaceType.toLowerCase())) return false;
    }

    const normalizedLocation = normalizeForMatch(location);
    const shouldApplyLocationFilter = normalizedLocation && !['united states', 'usa', 'us'].includes(normalizedLocation);
    if (shouldApplyLocationFilter) {
        const itemLocation = normalizeForMatch(item.location);
        if (!itemLocation || !itemLocation.includes(normalizedLocation)) return false;
    }

    return true;
};

const createSearchPageUrl = ({ baseUrl, searchState }) => {
    const url = new URL(baseUrl || BASE_URL);
    url.pathname = '/';
    url.searchParams.set('searchState', JSON.stringify(searchState));
    return url.toString();
};

const buildBatchFromRawJobs = ({
    rawJobs,
    state,
    resultsWanted,
    keyword,
    location,
    workplaceType,
}) => {
    const batch = [];

    for (const rawJob of rawJobs) {
        if (state.saved + batch.length >= resultsWanted) break;

        const item = normalizeJob(rawJob);
        if (Object.keys(item).length === 0) continue;
        if (!matchesOutputFilters({
            item,
            keyword,
            location,
            workplaceType,
        })) continue;

        const dedupeKey = toText(
            item.job_id ||
            item.url ||
            [item.title, item.company, item.location, item.date_posted].filter(Boolean).join('|'),
        );
        if (!dedupeKey || state.seen.has(dedupeKey)) continue;

        state.seen.add(dedupeKey);
        batch.push(item);
    }

    return batch;
};

const fetchJobsFromUrlscanCache = async ({ crawlerLog, maxScans = 8 }) => {
    const scansUrl = `https://urlscan.io/api/v1/search/?q=domain:${new URL(BASE_URL).hostname}&size=${maxScans}`;
    const scansResponse = await fetch(scansUrl);
    if (!scansResponse.ok) {
        throw new Error(`URLScan search failed with status ${scansResponse.status}`);
    }

    const scansJson = await scansResponse.json();
    const scans = Array.isArray(scansJson?.results) ? scansJson.results : [];

    for (const scan of scans) {
        const scanId = scan?.task?.uuid;
        if (!scanId) continue;

        try {
            const resultResponse = await fetch(`https://urlscan.io/api/v1/result/${scanId}/`);
            if (!resultResponse.ok) continue;
            const resultJson = await resultResponse.json();

            const apiRequest = (resultJson?.data?.requests || []).find((entry) => {
                const requestUrl = entry?.request?.request?.url || '';
                return requestUrl.includes('/api/search-jobs') && !requestUrl.includes('/get-total-count') && entry?.response?.hash;
            });
            if (!apiRequest?.response?.hash) continue;

            const cachedResponse = await fetch(`https://urlscan.io/responses/${apiRequest.response.hash}/`);
            if (!cachedResponse.ok) continue;
            const cachedText = await cachedResponse.text();

            let cachedJson = null;
            try {
                cachedJson = JSON.parse(cachedText);
            } catch {
                cachedJson = null;
            }

            const jobs = extractJobsArray(cachedJson);
            if (jobs.length > 0) {
                crawlerLog.warning(`Using URLScan cached API data from scan ${scanId} because live API is blocked.`);
                return jobs;
            }
        } catch (error) {
            crawlerLog.warning(`URLScan fallback scan ${scanId} failed: ${error.message}`);
        }
    }

    return [];
};

const isChallengeResponse = (text) => isBlockedText(text);

const waitForVerificationClearance = async ({ page, crawlerLog, timeoutMs = 30000 }) => {
    const started = Date.now();

    while ((Date.now() - started) < timeoutMs) {
        const probe = await page.evaluate(() => ({
            title: document.title || '',
            body: (document.body?.innerText || '').slice(0, 1000),
            href: window.location.href,
        })).catch(() => ({ title: '', body: '', href: '' }));

        const blocked = isBlockedText(`${probe.title} ${probe.body}`) || /\/cdn-cgi\/challenge-platform\//i.test(probe.href);
        if (!blocked) return true;

        await page.waitForTimeout(2500);
    }

    crawlerLog.warning('Browser verification did not clear before timeout.');
    return false;
};

const callApiInPage = async ({ page, url }) => {
    return page.evaluate(async ({ endpointUrl }) => {
        const response = await fetch(endpointUrl, {
            method: 'GET',
            credentials: 'include',
            mode: 'cors',
            cache: 'no-store',
            headers: {
                Accept: 'application/json, text/plain, */*',
                'X-Requested-With': 'XMLHttpRequest',
            },
        });

        const text = await response.text();
        let json = null;
        try {
            json = JSON.parse(text);
        } catch {
            json = null;
        }

        return {
            ok: response.ok,
            status: response.status,
            json,
            textSnippet: text.slice(0, 400),
        };
    }, { endpointUrl: url });
};

const getWithRetry = async ({ page, url, attempts, crawlerLog }) => {
    let lastError = null;

    for (let attempt = 1; attempt <= attempts; attempt++) {
        const response = await callApiInPage({ page, url });
        if (response.ok) return response;

        const error = new Error(`API ${url} returned ${response.status}. Body: ${response.textSnippet}`);
        error.status = response.status;
        error.body = response.textSnippet;
        error.url = url;
        lastError = error;

        if (response.status === 403 && isChallengeResponse(response.textSnippet)) {
            crawlerLog.warning(`Anti-bot challenge detected on ${url}. Waiting for verification clearance...`);
            await waitForVerificationClearance({
                page,
                crawlerLog,
                timeoutMs: 15000,
            });
        }

        const retryable = [401, 403, 408, 409, 425, 429, 500, 502, 503, 504].includes(response.status);
        if (!retryable || attempt === attempts) break;

        const sleepMs = Math.min(1000 * (2 ** (attempt - 1)), 8000) + Math.floor(Math.random() * 500);
        crawlerLog.warning(`Retrying ${url} after status ${response.status} (attempt ${attempt}/${attempts})`);
        await page.waitForTimeout(sleepMs);
    }

    throw lastError;
};

await Actor.init();

try {
    const input = (await Actor.getInput()) || {};
    const keyword = toText(input.keyword) || '';
    const location = toText(input.location);
    const workplaceTypeInput = toText(input.workplaceType) || 'Any';
    const workplaceType = ['Any', 'Remote', 'Hybrid', 'Onsite'].includes(workplaceTypeInput)
        ? workplaceTypeInput
        : 'Any';

    const resultsWanted = toNumber(input.results_wanted, DEFAULT_RESULTS_WANTED);
    const maxPages = toNumber(input.max_pages, DEFAULT_MAX_PAGES);
    const pageSize = DEFAULT_PAGE_SIZE;
    const startUrl = toAbsoluteUrl(input.startUrl) || BASE_URL;

    const proxyConfigurationInput = input.proxyConfiguration ?? { useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'] };
    let proxyConfiguration;
    try {
        proxyConfiguration = await Actor.createProxyConfiguration(proxyConfigurationInput);
    } catch (error) {
        log.warning(`Proxy configuration failed, continuing without proxy: ${error.message}`);
        proxyConfiguration = undefined;
    }

    const searchState = createSearchState({
        keyword,
        location,
        workplaceType,
    });
    const legacyEncodedSearchState = encodeLegacySearchState(searchState);
    const searchPageUrl = createSearchPageUrl({
        baseUrl: startUrl,
        searchState,
    });

    const state = {
        totalEstimated: null,
        saved: 0,
        seen: new Set(),
    };

    const crawler = new PlaywrightCrawler({
        launchContext: {
            launcher: firefox,
            launchOptions: {
                headless: false,
            },
        },
        proxyConfiguration,
        maxConcurrency: 1,
        maxRequestRetries: 3,
        requestHandlerTimeoutSecs: 180,
        navigationTimeoutSecs: 90,
        useSessionPool: true,
        browserPoolOptions: {
            useFingerprints: true,
        },
        sessionPoolOptions: {
            // Disable built-in 429 hard-fail on initial navigation; we handle retries manually on API calls.
            blockedStatusCodes: [0],
            maxPoolSize: 10,
            sessionOptions: {
                maxUsageCount: 25,
                maxErrorScore: 3,
            },
        },
        preNavigationHooks: [
            async ({ page }, gotoOptions) => {
                gotoOptions.waitUntil = 'domcontentloaded';
                await page.setExtraHTTPHeaders({
                    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Cache-Control': 'max-age=0',
                    'User-Agent': getRandomUserAgent(),
                });
            },
            async ({ page }) => {
                await page.route('**/*', (route) => {
                    const type = route.request().resourceType();
                    const url = route.request().url();

                    // Block images, fonts, media, stylesheets, and common trackers
                    if (['image', 'font', 'media', 'stylesheet'].includes(type) ||
                        url.includes('google-analytics') ||
                        url.includes('googletagmanager') ||
                        url.includes('facebook') ||
                        url.includes('doubleclick') ||
                        url.includes('adsense')) {
                        return route.abort();
                    }
                    return route.continue();
                });
            },
        ],
        async requestHandler({ page, log: crawlerLog }) {
            await page.waitForTimeout(1200);
            await waitForVerificationClearance({
                page,
                crawlerLog,
                timeoutMs: 30000,
            });

            const postWaitTitle = await page.title().catch(() => '');
            const postWaitBody = await page.evaluate(() => document.body?.innerText?.slice(0, 500) || '').catch(() => '');
            if (isBlockedText(`${postWaitTitle} ${postWaitBody}`)) {
                const debugHtml = await page.content().catch(() => null);
                if (debugHtml) {
                    await Actor.setValue('DEBUG_BLOCKED_PAGE', debugHtml, { contentType: 'text/html' });
                }

                const fallbackJobs = await fetchJobsFromUrlscanCache({ crawlerLog }).catch(() => []);
                if (fallbackJobs.length > 0) {
                    const fallbackBatch = buildBatchFromRawJobs({
                        rawJobs: fallbackJobs,
                        state,
                        resultsWanted,
                        keyword,
                        location,
                        workplaceType,
                    });
                    if (fallbackBatch.length > 0) {
                        await Actor.pushData(fallbackBatch);
                        state.saved += fallbackBatch.length;
                        state.totalEstimated = state.totalEstimated ?? fallbackJobs.length;
                        crawlerLog.info(`Saved ${state.saved}/${resultsWanted} jobs from fallback cache`);
                        return;
                    }
                }

                throw new Error('Anti-bot challenge still active after waiting for verification.');
            }

            for (const countUrl of [COUNT_ENDPOINT, `${COUNT_ENDPOINT}?s=${encodeURIComponent(legacyEncodedSearchState)}`]) {
                try {
                    const countResponse = await getWithRetry({
                        page,
                        url: countUrl,
                        attempts: 4,
                        crawlerLog,
                    });
                    const totalCount = Number(countResponse?.json?.total);
                    if (Number.isFinite(totalCount) && totalCount >= 0) {
                        state.totalEstimated = totalCount;
                        break;
                    }
                } catch (error) {
                    crawlerLog.warning(`Count endpoint unavailable for ${countUrl}: ${error.message}`);
                }
            }

            const fetchSearchJobs = async (pageIndex) => {
                const candidateUrls = [
                    `${SEARCH_ENDPOINT}?size=${pageSize}&page=${pageIndex}`,
                ];

                if (pageIndex === 0) {
                    candidateUrls.push(SEARCH_ENDPOINT);
                }

                candidateUrls.push(
                    `${SEARCH_ENDPOINT}?s=${encodeURIComponent(legacyEncodedSearchState)}&size=${pageSize}&page=${pageIndex}`,
                );

                if (pageIndex === 0) {
                    candidateUrls.push(`${SEARCH_ENDPOINT}?s=${encodeURIComponent(legacyEncodedSearchState)}`);
                }

                let lastError = null;
                for (const apiUrl of candidateUrls) {
                    try {
                        const response = await getWithRetry({ page, url: apiUrl, attempts: 4, crawlerLog });
                        const jobs = extractJobsArray(response.json);
                        if (jobs.length > 0) return jobs;

                        crawlerLog.info(`Search API variant returned 0 jobs: ${apiUrl}`);
                        if (pageIndex > 0) return [];
                    } catch (error) {
                        lastError = error;
                        crawlerLog.warning(`Search API variant failed: ${apiUrl} (${error.message})`);
                    }
                }

                if (lastError) throw lastError;
                return [];
            };

            for (let pageIndex = 0; pageIndex < maxPages && state.saved < resultsWanted; pageIndex++) {
                await delay(120 + Math.floor(Math.random() * 240));

                let jobs = [];
                try {
                    jobs = await fetchSearchJobs(pageIndex);
                } catch (error) {
                    const blockedError = error?.status === 403 || isChallengeResponse(error?.body || error?.message || '');
                    await Actor.setValue('DEBUG_SEARCH_STATE', searchState);
                    if (blockedError) {
                        const debugHtml = await page.content().catch(() => null);
                        if (debugHtml) {
                            await Actor.setValue('DEBUG_BLOCKED_PAGE', debugHtml, { contentType: 'text/html' });
                        }

                        if (pageIndex === 0 && state.saved === 0) {
                            const fallbackJobs = await fetchJobsFromUrlscanCache({ crawlerLog }).catch(() => []);
                            if (fallbackJobs.length > 0) {
                                const fallbackBatch = buildBatchFromRawJobs({
                                    rawJobs: fallbackJobs,
                                    state,
                                    resultsWanted,
                                    keyword,
                                    location,
                                    workplaceType,
                                });
                                if (fallbackBatch.length > 0) {
                                    await Actor.pushData(fallbackBatch);
                                    state.saved += fallbackBatch.length;
                                    state.totalEstimated = state.totalEstimated ?? fallbackJobs.length;
                                    crawlerLog.info(`Saved ${state.saved}/${resultsWanted} jobs from fallback cache`);
                                    break;
                                }
                            }
                        }

                        throw new Error(`Blocked by anti-bot while loading search page ${pageIndex}: ${error.message}`);
                    }
                    crawlerLog.error(`Search API failed on page ${pageIndex}: ${error.message}`);
                    if (pageIndex === 0) throw error;
                    break;
                }

                if (jobs.length === 0) {
                    crawlerLog.info(`No jobs returned on page ${pageIndex}. Stopping pagination.`);
                    break;
                }

                const batch = buildBatchFromRawJobs({
                    rawJobs: jobs,
                    state,
                    resultsWanted,
                    keyword,
                    location,
                    workplaceType,
                });

                if (batch.length > 0) {
                    await Actor.pushData(batch);
                    state.saved += batch.length;
                    crawlerLog.info(`Saved ${state.saved}/${resultsWanted} jobs`);
                } else if (pageIndex > 0) {
                    crawlerLog.info(`No new unique jobs on page ${pageIndex}. Stopping pagination.`);
                    break;
                }

                if (jobs.length < pageSize && pageIndex > 0) {
                    crawlerLog.info(`Last page detected on page ${pageIndex}.`);
                    break;
                }
            }
        },
        async failedRequestHandler({ request, log: crawlerLog, error }) {
            if (error.message?.includes('403')) {
                crawlerLog.warning(`Blocked (403): ${request.url} - skipping`);
            } else {
                crawlerLog.error(`Failed: ${request.url}`, { error: error.message });
            }
        },
    });

    log.info('Starting Hiring.Cafe scraping run', {
        startUrl,
        searchPageUrl,
        keyword: keyword || null,
        location: location || null,
        workplaceType,
        resultsWanted,
        maxPages,
        pageSize,
    });

    await crawler.run([{ url: searchPageUrl, userData: { label: 'SEARCH' } }]);

    log.info('Hiring.Cafe scraping finished', {
        saved: state.saved,
        totalEstimated: state.totalEstimated,
    });

    if (state.saved === 0) {
        log.warning('No jobs were collected. Enable proxyConfiguration and retry if blocked.');
    }
} catch (error) {
    log.exception(error, 'Actor run failed');
    process.exitCode = 1;
} finally {
    await Actor.exit();
}
