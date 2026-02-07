FROM apify/actor-node-playwright-firefox:22-1.56.1

COPY --chown=myuser:myuser package*.json ./
RUN npm install --omit=dev --omit=optional && rm -rf ~/.npm

COPY --chown=myuser:myuser . ./

CMD npm start --silent
