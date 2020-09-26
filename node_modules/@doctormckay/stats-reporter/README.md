# Anonymous Usage Statistics Reporter

This module reports anonymous usage statistics from my modules. Currently, this data is reported:

- Which module is sending statistics
- The version of Node.js you're running
- The version of my module you're running
- The version of the reporter module (this one) you're running
- An anonymous ID that opaquely identifies your machine
- Your CPU architecture
- Your CPU speed
- How many CPUs you have
- Your OS platform and version
- How much memory you have and how much is in use
- Your OS' uptime
- The uptime of your app

# Opting Out

You may opt-out in one of two ways:

1. Application authors: set `global._mckay_statistics_opt_out` to `true`
2. End-users: set the `NODE_MCKAY_STATISTICS_OPT_OUT` environment variable to `1`
