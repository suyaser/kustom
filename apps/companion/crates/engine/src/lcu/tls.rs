//! TLS to the League client on `127.0.0.1` (parity row 10, the `pinned` mode of `packages/lcu/src/tls.ts`).
//!
//! **What is trusted, exactly:**
//! - **One trust anchor: Riot's "LoL Game Engineering Certificate Authority"** (`certs/riotgames.pem`, a
//!   byte-for-byte copy of `packages/lcu/certs/riotgames.pem`, fetched from Riot's developer static host;
//!   SHA-256 `CA:8C:9D:32:...:4E:A3`). Not the system store, not any other root. The client's certificate
//!   must chain to it, be inside its validity period, and carry the server-auth usage if it names usages
//!   at all (webpki's normal end-entity checks).
//! - **Only for the address `127.0.0.1`.** The connection's server name must be the IP `127.0.0.1`;
//!   anything else (a hostname, `localhost`, another IP) is refused by this verifier before the chain is
//!   looked at. For `127.0.0.1` the certificate's own name is **not** checked, which is the one relaxation,
//!   the same one the TypeScript bridge makes: the client's leaf is issued for the loopback client, not for
//!   a name we could match, and the pin to Riot's root is what authenticates it.
//! - **No "accept any certificate" mode exists.** If a patch rotates the certificate so the pin fails, the
//!   bridge fails closed and the probe says so (the TypeScript `insecure` fallback is not ported; adding one
//!   is a decision row first, M17 rules).
//! - The handshake signature itself is checked with ring's algorithms, as rustls normally does.
//!
//! Riot's root is a v1, SHA-1 self-signed certificate. A trust anchor's own signature is never checked, so
//! that is fine; a SHA-1 signed *leaf* would be refused (as Node's default security level refuses it), and
//! 16.17 showed the pin works with no legacy digests (docs/03 "Auth"). Whether rustls/webpki accepts the
//! live leaf is exactly what the M17.5 probe verifies.

use std::fmt;
use std::net::{IpAddr, Ipv4Addr};
use std::sync::{Arc, Mutex};

use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::crypto::{
    CryptoProvider, WebPkiSupportedAlgorithms, verify_tls12_signature, verify_tls13_signature,
};
use rustls::pki_types::pem::PemObject;
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use rustls::server::ParsedCertificate;
use rustls::{CertificateError, ClientConfig, DigitallySignedStruct, Error, RootCertStore, SignatureScheme};

/// Riot's root, embedded so the shipped exe needs no file beside it.
pub const RIOT_ROOT_PEM: &str = include_str!("../../certs/riotgames.pem");

/// The only address the client listens on, and the only one this verifier accepts.
pub const LCU_IP: Ipv4Addr = Ipv4Addr::LOCALHOST;

/// Why a trust anchor could not be loaded.
#[derive(Debug)]
pub struct AnchorError(String);

impl fmt::Display for AnchorError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "trust anchor: {}", self.0)
    }
}

impl std::error::Error for AnchorError {}

/// The ring provider every LCU connection uses (decision row 2026-10-04: ring, not aws-lc).
pub fn provider() -> Arc<CryptoProvider> {
    Arc::new(rustls::crypto::ring::default_provider())
}

/// A root store holding exactly the PEM certificates given.
pub fn roots_from_pem(pem: &str) -> Result<RootCertStore, AnchorError> {
    let mut roots = RootCertStore::empty();
    for cert in CertificateDer::pem_slice_iter(pem.as_bytes()) {
        let cert = cert.map_err(|e| AnchorError(e.to_string()))?;
        roots.add(cert).map_err(|e| AnchorError(e.to_string()))?;
    }
    if roots.is_empty() {
        return Err(AnchorError("no certificate in the PEM".into()));
    }
    Ok(roots)
}

/// The verifier described in the module docs.
pub struct LcuCertVerifier {
    roots: RootCertStore,
    algorithms: WebPkiSupportedAlgorithms,
    /// Dev-only: the probe records the chain the client presented, to print it.
    seen: Option<Arc<Mutex<Vec<CertificateDer<'static>>>>>,
}

impl fmt::Debug for LcuCertVerifier {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("LcuCertVerifier")
            .field("anchors", &self.roots.len())
            .finish()
    }
}

impl LcuCertVerifier {
    /// Pinned to Riot's root.
    pub fn riot() -> Result<Self, AnchorError> {
        Self::pinned_to(roots_from_pem(RIOT_ROOT_PEM)?)
    }

    /// Pinned to other roots: tests pin to their own CA, never production.
    pub fn pinned_to(roots: RootCertStore) -> Result<Self, AnchorError> {
        Ok(Self {
            roots,
            algorithms: provider().signature_verification_algorithms,
            seen: None,
        })
    }

    /// Records every presented chain into `sink` (the probe prints the leaf).
    pub fn recording(mut self, sink: Arc<Mutex<Vec<CertificateDer<'static>>>>) -> Self {
        self.seen = Some(sink);
        self
    }
}

/// True for the one server name the verifier accepts.
pub fn is_lcu_server_name(name: &ServerName<'_>) -> bool {
    matches!(name, ServerName::IpAddress(ip) if IpAddr::from(*ip) == IpAddr::V4(LCU_IP))
}

impl ServerCertVerifier for LcuCertVerifier {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        intermediates: &[CertificateDer<'_>],
        server_name: &ServerName<'_>,
        _ocsp_response: &[u8],
        now: UnixTime,
    ) -> Result<ServerCertVerified, Error> {
        if let Some(seen) = &self.seen {
            if let Ok(mut chain) = seen.lock() {
                chain.clear();
                chain.push(end_entity.clone().into_owned());
                chain.extend(intermediates.iter().map(|c| c.clone().into_owned()));
            }
        }
        if !is_lcu_server_name(server_name) {
            return Err(Error::InvalidCertificate(CertificateError::NotValidForName));
        }
        let cert = ParsedCertificate::try_from(end_entity)?;
        rustls::client::verify_server_cert_signed_by_trust_anchor(
            &cert,
            &self.roots,
            intermediates,
            now,
            self.algorithms.all,
        )?;
        Ok(ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, Error> {
        verify_tls12_signature(message, cert, dss, &self.algorithms)
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, Error> {
        verify_tls13_signature(message, cert, dss, &self.algorithms)
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.algorithms.supported_schemes()
    }
}

/// A rustls client config using `verifier`, ALPN `http/1.1` (the client speaks HTTP/1.1; the WebSocket
/// upgrade needs it too). No client certificate.
pub fn client_config(verifier: LcuCertVerifier) -> Result<ClientConfig, Error> {
    let mut config = ClientConfig::builder_with_provider(provider())
        .with_safe_default_protocol_versions()?
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(verifier))
        .with_no_client_auth();
    config.alpn_protocols = vec![b"http/1.1".to_vec()];
    Ok(config)
}

/// PEM text of a DER certificate (certificates are public; the probe prints the client's leaf).
pub fn to_pem(cert: &CertificateDer<'_>) -> String {
    use base64::Engine as _;
    let b64 = base64::engine::general_purpose::STANDARD.encode(cert.as_ref());
    let mut out = String::from("-----BEGIN CERTIFICATE-----\n");
    for chunk in b64.as_bytes().chunks(64) {
        out.push_str(&String::from_utf8_lossy(chunk));
        out.push('\n');
    }
    out.push_str("-----END CERTIFICATE-----\n");
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_embedded_root_is_the_vendored_one_and_loads_as_an_anchor() {
        let vendored = include_str!("../../../../../../packages/lcu/certs/riotgames.pem");
        assert_eq!(
            RIOT_ROOT_PEM, vendored,
            "crates/engine/certs/riotgames.pem drifted from packages/lcu"
        );
        let roots = roots_from_pem(RIOT_ROOT_PEM).unwrap();
        assert_eq!(roots.len(), 1);
        assert!(LcuCertVerifier::riot().is_ok());
    }

    #[test]
    fn only_the_ip_127_0_0_1_is_an_lcu_name() {
        assert!(is_lcu_server_name(&ServerName::try_from("127.0.0.1").unwrap()));
        for other in ["localhost", "127.0.0.2", "10.0.0.1", "::1", "riotgames.com"] {
            assert!(
                !is_lcu_server_name(&ServerName::try_from(other).unwrap()),
                "{other}"
            );
        }
    }

    #[test]
    fn pem_round_trip() {
        let der = CertificateDer::from_pem_slice(RIOT_ROOT_PEM.as_bytes()).unwrap();
        let again = CertificateDer::from_pem_slice(to_pem(&der).as_bytes()).unwrap();
        assert_eq!(der, again);
    }
}
