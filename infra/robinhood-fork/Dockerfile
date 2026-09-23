# The Robinhood Chain node behind the Robinhood executor (entrypoint.sh explains the snapshot and fork modes).
#
# Deployed to the Railway service `robinhood-fork`, volume at /data:
#   railway up --project <id> --environment production --service robinhood-fork --ci     # from this directory
FROM ghcr.io/foundry-rs/foundry:v1.7.1

USER root
COPY snapshot.json /opt/robinhood/snapshot.json
COPY entrypoint.sh /usr/local/bin/node-entrypoint
RUN chmod 0755 /usr/local/bin/node-entrypoint

ENTRYPOINT ["/usr/local/bin/node-entrypoint"]
