FROM node:18

WORKDIR /app

RUN apt update
RUN apt install -y dnsutils

COPY package*.json ./
RUN npm install

COPY . .
