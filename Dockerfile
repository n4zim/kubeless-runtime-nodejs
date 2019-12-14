FROM node:13-alpine

WORKDIR /runtime

ADD package.json .
ADD yarn.lock .
RUN yarn install --production

ADD dist dist
ADD kiwi.sh /usr/bin/kiwi

USER 1000

CMD [ "kiwi", "start" ]
