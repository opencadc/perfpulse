# perfpulse image: locked uv install into python slim, non-root. The entrypoint runs one probe:
#   perfpulse <module>:<function>
# Probes from other repositories: FROM this image, COPY modules into /probes (on PYTHONPATH).
# Base images match science-platform/metrics (pinned by digest).
FROM ghcr.io/astral-sh/uv:0.13.10@sha256:a3ea1357342c1a4bf9a0c53a3deb1b55379aefa037338d8113d5771efa01774f AS uv

FROM python:3.15-slim@sha256:94d3426f1def7db4a106a232ac121bfd975393e5dfd40a619b955fae45fe7913 AS builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    UV_NO_DEV=1

COPY --from=uv /uv /usr/local/bin/uv

WORKDIR /build

COPY pyproject.toml uv.lock README.md ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-install-project

COPY src ./src
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-editable

FROM python:3.15-slim@sha256:94d3426f1def7db4a106a232ac121bfd975393e5dfd40a619b955fae45fe7913 AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/opt/venv/bin:$PATH" \
    PYTHONPATH=/probes

RUN groupadd --system --gid 65532 perfpulse \
    && useradd --system --uid 65532 --gid perfpulse --home-dir /nonexistent --shell /usr/sbin/nologin perfpulse \
    && mkdir /probes

COPY --from=builder --chown=perfpulse:perfpulse /opt/venv /opt/venv

USER perfpulse

ENTRYPOINT ["perfpulse"]
