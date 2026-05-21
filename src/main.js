import { Actor, log } from 'apify';

const BASE_URL = 'https://hiring.cafe';
const DEFAULT_RESULTS_WANTED = 20;
const DEFAULT_MAX_PAGES = 10;
const DEFAULT_PAGE_SIZE = 40;
const DEFAULT_DATE_FETCHED_PAST_DAYS = 61;
const REQUEST_TIMEOUT_MS = 30000;

const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
];

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

const toWebsiteUrl = (value) => {
    const text = toText(value);
    if (!text) return null;

    const candidate = text.startsWith('http://') || text.startsWith('https://')
        ? text
        : `https://${text}`;
    return toAbsoluteUrl(candidate);
};

const stripHtml = (htmlText) => {
    const text = toText(htmlText);
    if (!text) return null;
    return toText(text.replace(/<[^>]*>/g, ' '));
};

const sanitizeUrlForLog = (value) => {
    const text = toText(value);
    if (!text) return '';

    try {
        const url = new URL(text);
        if (url.searchParams.has('searchState')) {
            url.searchParams.set('searchState', '[searchState]');
        }
        const compact = url.toString();
        return compact.length > 220 ? `${compact.slice(0, 220)}...` : compact;
    } catch {
        return text.length > 220 ? `${text.slice(0, 220)}...` : text;
    }
};

const fetchWithTimeout = async (url, options = {}) => {
    const { timeoutMs = REQUEST_TIMEOUT_MS, ...fetchOptions } = options;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        return await fetch(url, {
            ...fetchOptions,
            signal: controller.signal,
        });
    } finally {
        clearTimeout(timer);
    }
};

const parseSearchStateFromUrl = (urlValue) => {
    const absolute = toAbsoluteUrl(urlValue);
    if (!absolute) return null;

    try {
        const url = new URL(absolute);
        const searchStateParam = url.searchParams.get('searchState');
        if (searchStateParam) return JSON.parse(searchStateParam);
    } catch {
        return null;
    }

    return null;
};

const extractLocationFromSearchState = (searchState) => {
    if (!searchState || !Array.isArray(searchState.locations) || searchState.locations.length === 0) return null;

    const first = searchState.locations[0] || {};
    return toText(
        first.formatted_address ||
        first.description ||
        first.long_name ||
        first.name,
    );
};

const extractWorkplaceTypeFromSearchState = (searchState) => {
    if (!searchState || !Array.isArray(searchState.workplaceTypes) || searchState.workplaceTypes.length === 0) return null;

    const normalized = searchState.workplaceTypes
        .map((value) => toText(value))
        .filter(Boolean);
    if (normalized.length === 0) return null;

    const unique = new Set(normalized);
    const allTypes = ['Remote', 'Hybrid', 'Onsite'];
    if (allTypes.every((type) => unique.has(type))) return 'Any';
    if (unique.size === 1 && allTypes.includes(normalized[0])) return normalized[0];

    return 'Any';
};

const createSearchState = ({ keyword, location, workplaceType, baseSearchState = null }) => {
    const normalizedLocation = toText(location);
    const workplaceTypes = workplaceType === 'Any' ? ['Remote', 'Hybrid', 'Onsite'] : [workplaceType];

    const searchState = {
        locations: Array.isArray(baseSearchState?.locations) ? baseSearchState.locations : [],
        workplaceTypes: Array.isArray(baseSearchState?.workplaceTypes) && baseSearchState.workplaceTypes.length > 0
            ? baseSearchState.workplaceTypes
            : workplaceTypes,
        defaultToUserLocation: baseSearchState?.defaultToUserLocation ?? false,
        userLocation: baseSearchState?.userLocation ?? null,
        searchQuery: keyword || baseSearchState?.searchQuery || '',
        dateFetchedPastNDays: Number.isFinite(Number(baseSearchState?.dateFetchedPastNDays))
            ? Number(baseSearchState.dateFetchedPastNDays)
            : DEFAULT_DATE_FETCHED_PAST_DAYS,
    };

    searchState.workplaceTypes = workplaceTypes;

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
    } else if (!normalizedLocation && Array.isArray(baseSearchState?.locations) && baseSearchState.locations.length > 0) {
        searchState.locations = baseSearchState.locations;
    }

    return searchState;
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

const getCompanyName = (job, jobInfo = {}, processed = {}) => toText(
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

const normalizeJob = (rawJob) => {
    const job = rawJob || {};
    const jobInfo = job?.job_information || {};
    const processed = job?.v5_processed_job_data || {};
    const jobId = toText(job.id || job.jobId || job._id || job.uuid || job.slug);
    const commitment = Array.isArray(processed?.commitment) ? processed.commitment.join(', ') : processed?.commitment;
    const descriptionHtml = sanitizeDescriptionHtml(
        jobInfo.description || job.description || job.descriptionHtml || job.jobDescription || job.requirements,
    );
    const requirementsSummary = toText(processed?.requirements_summary || job?.requirements_summary);
    const descriptionText = toText(stripHtml(descriptionHtml)) || requirementsSummary;
    const descriptionHtmlFallback = descriptionHtml || (requirementsSummary ? `<p>${requirementsSummary}</p>` : null);

    const yearlyMinComp = processed?.yearly_min_compensation ?? null;
    const yearlyMaxComp = processed?.yearly_max_compensation ?? null;
    const monthlyMinComp = processed?.monthly_min_compensation ?? null;
    const monthlyMaxComp = processed?.monthly_max_compensation ?? null;

    const companyWebsite = toWebsiteUrl(
        job?.v5_processed_company_data?.website ||
        processed?.company_website ||
        job?.enriched_company_data?.homepage_uri,
    );

    const item = {
        job_id: toText(jobId),
        title: toText(jobInfo.title || job.title || job.jobTitle || job.position || job.role || job.name),
        company: toText(getCompanyName(job, jobInfo, processed)),
        source: toText(job.source),
        board_token: toText(job.board_token),
        source_and_board_token: toText(job.source_and_board_token),
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
        compensation_currency: toText(processed?.listed_compensation_currency || job?.compensationCurrency || job?.currency),
        compensation_frequency: toText(processed?.listed_compensation_frequency || job?.compensationFrequency || job?.frequency),
        yearly_min_compensation: yearlyMinComp,
        yearly_max_compensation: yearlyMaxComp,
        monthly_min_compensation: monthlyMinComp,
        monthly_max_compensation: monthlyMaxComp,
        date_posted: toText(
            processed?.estimated_publish_date ||
            job.datePosted ||
            job.postedAt ||
            job.publishedAt ||
            job.createdAt ||
            job.dateFetched,
        ),
        description_html: descriptionHtmlFallback,
        description_text: descriptionText,
        requirements_summary: requirementsSummary,
        technical_tools: Array.isArray(processed?.technical_tools) ? processed.technical_tools.filter(Boolean) : null,
        role_type: toText(processed?.role_type),
        seniority_level: toText(processed?.seniority_level),
        job_category: toText(processed?.job_category),
        security_clearance: toText(processed?.security_clearance),
        language_requirements: Array.isArray(processed?.language_requirements) ? processed.language_requirements.filter(Boolean) : null,
        workplace_countries: Array.isArray(processed?.workplace_countries) ? processed.workplace_countries.filter(Boolean) : null,
        company_website: companyWebsite,
        company_industries: Array.isArray(job?.enriched_company_data?.industries)
            ? job.enriched_company_data.industries.filter(Boolean)
            : null,
        company_activities: Array.isArray(job?.enriched_company_data?.activities)
            ? job.enriched_company_data.activities.filter(Boolean)
            : null,
        company_size: job?.enriched_company_data?.nb_employees ?? null,
        company_founded_year: job?.enriched_company_data?.year_founded ?? null,
        company_tagline: toText(
            job?.enriched_company_data?.tagline ||
            processed?.company_tagline,
        ),
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

const getKeywordTokens = (value) => {
    const normalized = normalizeForMatch(value);
    if (!normalized) return [];

    return normalized
        .split(/[^a-z0-9]+/i)
        .map((token) => token.trim())
        .filter((token) => token.length >= 2);
};

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

        if (!haystack) return false;
        if (!haystack.includes(normalizedKeyword)) {
            const keywordTokens = getKeywordTokens(normalizedKeyword);
            const hasAllTokens = keywordTokens.length > 0 && keywordTokens.every((token) => haystack.includes(token));
            if (!hasAllTokens) return false;
        }
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

const createSearchPageUrl = ({ baseUrl, searchState, page = 0 }) => {
    const url = new URL(baseUrl || BASE_URL);
    url.pathname = '/';
    url.searchParams.set('searchState', JSON.stringify(searchState));
    url.searchParams.set('page', String(page));
    return url.toString();
};

const buildNextDataUrl = ({ buildId, searchState, page }) => {
    const url = new URL(`/_next/data/${buildId}/index.json`, BASE_URL);
    url.searchParams.set('searchState', JSON.stringify(searchState));
    url.searchParams.set('page', String(page));
    return url.toString();
};

const extractNextDataJson = (html) => {
    const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
    if (!match) {
        throw new Error('Could not find __NEXT_DATA__ in bootstrap HTML.');
    }

    return JSON.parse(match[1]);
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
        if (!matchesOutputFilters({ item, keyword, location, workplaceType })) continue;

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

const createBrowserLikeHeaders = ({ accept, referer }) => ({
    Accept: accept,
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control': 'no-cache',
    Pragma: 'no-cache',
    Referer: referer,
    'Sec-CH-UA': '"Chromium";v="136", "Google Chrome";v="136", "Not.A/Brand";v="99"',
    'Sec-CH-UA-Mobile': '?0',
    'Sec-CH-UA-Platform': '"Windows"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'same-origin',
    'Upgrade-Insecure-Requests': '1',
    'User-Agent': getRandomUserAgent(),
});

const fetchBootstrapPage = async ({ searchPageUrl }) => {
    const response = await fetchWithTimeout(searchPageUrl, {
        headers: createBrowserLikeHeaders({
            accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            referer: BASE_URL,
        }),
    });

    if (!response.ok) {
        throw new Error(`Bootstrap page ${sanitizeUrlForLog(searchPageUrl)} returned ${response.status}`);
    }

    const html = await response.text();
    const nextData = extractNextDataJson(html);

    return {
        html,
        nextData,
        pageProps: nextData?.props?.pageProps || {},
        buildId: toText(nextData?.buildId),
    };
};

const fetchNextDataPage = async ({ buildId, searchState, page, referer }) => {
    const url = buildNextDataUrl({ buildId, searchState, page });
    const response = await fetchWithTimeout(url, {
        headers: createBrowserLikeHeaders({
            accept: 'application/json,text/plain,*/*',
            referer,
        }),
    });

    if (!response.ok) {
        throw new Error(`Next data ${sanitizeUrlForLog(url)} returned ${response.status}`);
    }

    return {
        url,
        json: await response.json(),
    };
};

await Actor.init();

try {
    const input = (await Actor.getInput()) || {};
    const startUrl = toAbsoluteUrl(input.startUrl) || BASE_URL;
    const startUrlSearchState = parseSearchStateFromUrl(startUrl);

    const keywordInput = toText(input.keyword);
    const keywordFromStartUrl = toText(startUrlSearchState?.searchQuery);
    const keyword = keywordInput || keywordFromStartUrl || '';

    const locationInput = toText(input.location);
    const locationFromStartUrl = extractLocationFromSearchState(startUrlSearchState);
    const location = locationInput || locationFromStartUrl;

    const workplaceTypeInput = toText(input.workplaceType);
    const normalizedWorkplaceInput = ['Any', 'Remote', 'Hybrid', 'Onsite'].includes(workplaceTypeInput || '')
        ? workplaceTypeInput
        : null;
    const workplaceTypeFromStartUrl = extractWorkplaceTypeFromSearchState(startUrlSearchState);
    const workplaceType = normalizedWorkplaceInput || workplaceTypeFromStartUrl || 'Any';

    const resultsWanted = toNumber(input.results_wanted, DEFAULT_RESULTS_WANTED);
    const maxPages = toNumber(input.max_pages, DEFAULT_MAX_PAGES);

    const searchState = createSearchState({
        keyword,
        location,
        workplaceType,
        baseSearchState: startUrlSearchState,
    });
    const searchPageUrl = createSearchPageUrl({
        baseUrl: startUrl,
        searchState,
        page: 0,
    });

    const state = {
        totalEstimated: null,
        saved: 0,
        seen: new Set(),
    };

    log.info('Starting Hiring.Cafe scraping run', {
        startUrl,
        searchPageUrl,
        keyword: keyword || null,
        location: location || null,
        workplaceType,
        resultsWanted,
        maxPages,
    });

    const bootstrap = await fetchBootstrapPage({ searchPageUrl });
    if (!bootstrap.buildId) {
        throw new Error('Could not determine Next.js buildId from bootstrap response.');
    }

    state.totalEstimated = Number.isFinite(Number(bootstrap.pageProps?.ssrTotalCount))
        ? Number(bootstrap.pageProps.ssrTotalCount)
        : null;

    const bootstrapJobs = Array.isArray(bootstrap.pageProps?.ssrHits) ? bootstrap.pageProps.ssrHits : [];
    const bootstrapBatch = buildBatchFromRawJobs({
        rawJobs: bootstrapJobs,
        state,
        resultsWanted,
        keyword,
        location,
        workplaceType,
    });

    if (bootstrapBatch.length > 0) {
        await Actor.pushData(bootstrapBatch);
        state.saved += bootstrapBatch.length;
        log.info(`Saved ${state.saved}/${resultsWanted} jobs from SSR page 0`, {
            buildId: bootstrap.buildId,
            totalEstimated: state.totalEstimated,
            pageHits: bootstrapJobs.length,
            reportedPageSize: bootstrap.pageProps?.ssrPageSize || DEFAULT_PAGE_SIZE,
        });
    }

    let isLastPage = Boolean(bootstrap.pageProps?.ssrIsLastPage);

    for (let pageIndex = 1; pageIndex < maxPages && state.saved < resultsWanted && !isLastPage; pageIndex++) {
        const referer = createSearchPageUrl({
            baseUrl: startUrl,
            searchState,
            page: Math.max(0, pageIndex - 1),
        });
        const pageResponse = await fetchNextDataPage({
            buildId: bootstrap.buildId,
            searchState,
            page: pageIndex,
            referer,
        });

        const pageProps = pageResponse.json?.pageProps || {};
        const rawJobs = Array.isArray(pageProps?.ssrHits) ? pageProps.ssrHits : [];
        isLastPage = Boolean(pageProps?.ssrIsLastPage);
        if (Number.isFinite(Number(pageProps?.ssrTotalCount))) {
            state.totalEstimated = Number(pageProps.ssrTotalCount);
        }

        if (rawJobs.length === 0) {
            log.info(`No jobs returned on SSR page ${pageIndex}. Stopping pagination.`, {
                url: sanitizeUrlForLog(pageResponse.url),
            });
            break;
        }

        const batch = buildBatchFromRawJobs({
            rawJobs,
            state,
            resultsWanted,
            keyword,
            location,
            workplaceType,
        });

        if (batch.length > 0) {
            await Actor.pushData(batch);
            state.saved += batch.length;
            log.info(`Saved ${state.saved}/${resultsWanted} jobs`, {
                page: pageIndex,
                pageHits: rawJobs.length,
                reportedPageSize: pageProps?.ssrPageSize || DEFAULT_PAGE_SIZE,
                isLastPage,
            });
        } else {
            log.info(`SSR page ${pageIndex} returned only duplicate or filtered jobs.`, {
                url: sanitizeUrlForLog(pageResponse.url),
                pageHits: rawJobs.length,
            });
        }
    }

    log.info('Hiring.Cafe scraping finished', {
        saved: state.saved,
        totalEstimated: state.totalEstimated,
        searchPageUrl,
        transport: 'next-data-ssr',
    });

    if (state.saved === 0) {
        log.warning('No jobs were collected from the SSR payload. The site may have changed its search transport again.');
    }
} catch (error) {
    log.exception(error, 'Actor run failed');
    process.exitCode = 1;
} finally {
    await Actor.exit();
}
