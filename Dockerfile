FROM grafana/k6:1.7.1 AS k6

FROM alpine:3.22
RUN apk add --no-cache ca-certificates curl kubectl stress-ng
COPY --from=k6 /usr/bin/k6 /usr/bin/k6
COPY dist/perfpulse.js /test/perfpulse.js
ENTRYPOINT ["k6"]
