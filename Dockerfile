FROM node:6
MAINTAINER kumavis

# setup app dir
RUN mkdir -p /www/
WORKDIR /www/

# install dependencies
COPY ./package.json /www/package.json
RUN npm install

# copy over app dir
COPY ./src /www/src

# run tests
RUN npm test

# start server
# CMD curl -X POST http://parity:8545
# CMD cat /etc/hosts
# CMD curl -X POST http://172.17.0.2:8545
# CMD sleep infinity
CMD npm start
