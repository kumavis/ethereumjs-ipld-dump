FROM node:6
MAINTAINER kumavis

# setup app dir
RUN mkdir -p /www/
WORKDIR /www/
RUN git clone https://github.com/kumavis/js-ipfs.git && cd js-ipfs && git fetch origin && git checkout a6e0db192eb65ba387222b5dd9717a3dff7c1dab
WORKDIR /www/js-ipfs
RUN npm install

# start server
CMD node src/cli/bin.js init || rm -rf "$IPFS_PATH/api" && node src/cli/bin.js daemon