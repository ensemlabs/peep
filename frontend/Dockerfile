FROM node:24.15.0-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.29.8-alpine
# MAX_UPLOAD_MB is substituted into the template by the image's envsubst hook.
ENV MAX_UPLOAD_MB=200
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
