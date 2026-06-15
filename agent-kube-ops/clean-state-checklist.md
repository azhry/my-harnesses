# Clean State Checklist

Run through before ending a session:

- [ ] `bash init.sh` passes (tools + permissions)
- [ ] PROGRESS.md is updated with current state
- [ ] feature_list.json reflects actual status (no false `passing` entries)
- [ ] state/current-deployment.json is accurate
- [ ] No half-finished manifests or Dockerfiles left uncommitted
- [ ] Next session can run `bash init.sh` immediately without manual fixes
