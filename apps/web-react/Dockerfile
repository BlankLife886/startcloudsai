# syntax=docker/dockerfile:1

FROM node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2 AS build
WORKDIR /repo

# The React build imports source from both sibling applications. Install each
# dependency tree before copying source so dependency layers remain cacheable.
COPY apps/web/package.json apps/web/package-lock.json apps/web/
COPY apps/canvas-react/package.json apps/canvas-react/package-lock.json apps/canvas-react/
COPY apps/web-react/package.json apps/web-react/package-lock.json apps/web-react/
RUN --mount=type=cache,target=/root/.npm \
    npm --prefix apps/web ci --no-audit --no-fund && \
    npm --prefix apps/canvas-react ci --no-audit --no-fund && \
    npm --prefix apps/web-react ci --no-audit --no-fund

COPY apps/web apps/web
COPY apps/canvas-react apps/canvas-react
COPY apps/web-react apps/web-react
RUN npm --prefix apps/web-react run build

FROM nginx:alpine@sha256:4a73073bd557c65b759505da037898b61f1be6cbcc3c2c3aeac22d2a470c1752
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web-react/dist /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
