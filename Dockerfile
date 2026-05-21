FROM apify/actor-node-playwright-chrome:24-1.59.1

COPY --chown=myuser:myuser package*.json ./
RUN npm install --omit=dev --omit=optional && rm -rf ~/.npm

COPY --chown=myuser:myuser . ./

CMD npm start --silent
