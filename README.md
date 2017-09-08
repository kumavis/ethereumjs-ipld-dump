Uses millions and millions of inodes. So need to config machine a bit.

### create DigitalOcean block storage with extra inodes (120000000)

[![Greenkeeper badge](https://badges.greenkeeper.io/kumavis/ethereumjs-ipld-dump.svg)](https://greenkeeper.io/)

sudo mkfs.ext4 -N 120000000 -F /dev/disk/by-id/scsi-0DO_Volume_volume-sfo2-01

sudo mkdir -p /mnt/volume-sfo2-01
sudo mount -o discard,defaults /dev/disk/by-id/scsi-0DO_Volume_volume-sfo2-01 /mnt/volume-sfo2-01
echo /dev/disk/by-id/scsi-0DO_Volume_volume-sfo2-01 /mnt/volume-sfo2-01 ext4 defaults,nofail,discard 0 0 | sudo tee -a /etc/fstab