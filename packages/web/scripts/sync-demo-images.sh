#!/bin/sh
# Mirrors ./demo-menu into the stage's DemoMenuFiles bucket, served by the web CloudFront on /demo-menu/*.
# Run through `npm run demo-images:dev -w @atendy/web` (aws-vault credentials); the web must be deployed once first.
set -eu

cd "$(dirname "$0")/.."

# Ez4 names buckets `<stage>-<project>-<service>-<random>`.
prefix="${APP_STAGE:?Set APP_STAGE}-atendy-web-demo-menu-files-"

buckets=$(aws s3api list-buckets --query "Buckets[?starts_with(Name, '${prefix}')].Name" --output text)

case "$buckets" in
  "" | None)
    echo "No bucket ${prefix}*: deploy the web first (npm run deploy:dev -w @atendy/web)." >&2
    exit 1
    ;;
  *[[:space:]]*)
    echo "More than one bucket ${prefix}*: ${buckets}" >&2
    exit 1
    ;;
esac

aws s3 sync demo-menu "s3://${buckets}/demo-menu" \
  --delete \
  --size-only \
  --exclude '.*' \
  --content-type image/webp \
  --cache-control 'public, max-age=86400'
