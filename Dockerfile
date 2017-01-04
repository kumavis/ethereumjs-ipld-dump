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
CMD npm start
