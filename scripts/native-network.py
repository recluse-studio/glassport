"""Open a trusted exact-device RSD tunnel through its configured network endpoint."""
from pymobiledevice3.remote import userspace_tunnel
from pymobiledevice3.remote.tunnel_service import RemotePairingTunnelService


class PairedNetworkTunnel(userspace_tunnel.UserspaceRsdTunnel):
    def __init__(self, serial, host, port):
        super().__init__(serial=serial, autopair=False)
        self.host, self.port = host, port

    async def aopen(self):
        if self.rsd is not None:
            return self.rsd
        original_provider = userspace_tunnel._create_no_root_tunnel_provider

        async def paired_provider(serial, autopair, remotepairing_fallback=True):
            if serial != self.serial or autopair:
                raise ValueError('The network tunnel requires the selected existing pair record.')
            provider = RemotePairingTunnelService(serial, self.host, self.port)
            try:
                await provider.connect(autopair=False)
            except BaseException:
                await provider.close()
                raise
            return provider, None

        # The pinned client has no provider argument. Override only its startup factory
        # inside this isolated, single-tunnel child; preserve its complete close lifecycle.
        userspace_tunnel._create_no_root_tunnel_provider = paired_provider
        try:
            return await super().aopen()
        finally:
            userspace_tunnel._create_no_root_tunnel_provider = original_provider
