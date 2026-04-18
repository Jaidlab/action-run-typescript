# syntax=docker/dockerfile:1

ARG baseImage=debian:13.4-slim
ARG bunVersion=1.3.12

FROM ${baseImage}

ENV DEBIAN_FRONTEND=noninteractive
ENV BUN_RUNTIME_TRANSPILER_CACHE_PATH=0

SHELL ["/bin/sh", "-euxc"]

RUN apt-get update \
  && apt-get install --yes --no-install-recommends ca-certificates curl unzip \
  && architecture="$(dpkg --print-architecture)" \
  && case "$architecture" in \
    amd64) bunArchitecture='x64-baseline' ;; \
    arm64) bunArchitecture='aarch64' ;; \
    *) echo "Unsupported Debian architecture: $architecture" >&2; exit 1 ;; \
  esac \
  && curl --fail --location --output /tmp/bun.zip "https://github.com/oven-sh/bun/releases/download/bun-v${bunVersion}/bun-linux-$bunArchitecture.zip" \
  && unzip /tmp/bun.zip -d /tmp \
  && mv "/tmp/bun-linux-$bunArchitecture/bun" /usr/local/bin/bun \
  && ln -s /usr/local/bin/bun /usr/local/bin/bunx \
  && rm -rf /tmp/bun.zip "/tmp/bun-linux-$bunArchitecture" \
  && apt-get purge --yes --auto-remove curl unzip \
  && rm -rf /var/lib/apt/lists/* \
  && bun --version

WORKDIR /action

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production --ignore-scripts \
  && rm -rf /root/.bun/install/cache /tmp/*

COPY src ./src

ENTRYPOINT ["bun", "./src/main.ts"]
