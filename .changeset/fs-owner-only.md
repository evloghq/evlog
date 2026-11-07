---
"evlog": major
---

On macOS and Linux, the file system drain (`evlog/fs`) creates its directories with mode `0700` and its log files with mode `0600`, so only the account that runs the app can read the events. Before, both followed the process umask, usually `0755` and `0644`, which let every account on the machine read them. Windows is unchanged: Node applies only the write bit there, so the files keep the permissions inherited from their folder.

A directory or file that already exists keeps its mode. Run `chmod -R go= .evlog` to restrict logs written before the upgrade. Another account can no longer open the new files. A log shipper running as its own user should run as the app's account, or receive the events through an HTTP drain. A container running as root that writes into a bind-mounted project on Linux now leaves files your own account cannot read: run it with `--user "$(id -u):$(id -g)"`.
