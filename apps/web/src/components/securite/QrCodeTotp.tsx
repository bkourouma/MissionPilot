"use client";

import { useMemo } from "react";
import { cheminSvg, genererQrCode } from "../../lib/qrcode";
import { useT } from "../i18n/FournisseurLangue";

/**
 * QR code de l'URI `otpauth://` généré dans le navigateur (aucun service externe, aucune
 * dépendance) : le secret ne quitte jamais la page. Noir sur blanc quel que soit le thème,
 * pour rester lisible par les appareils photo.
 */
export function QrCodeTotp({ uri }: { uri: string }) {
  const t = useT();
  const qr = useMemo(() => {
    try {
      return genererQrCode(uri);
    } catch {
      return null;
    }
  }, [uri]);
  if (!qr) {
    return (
      <p className="mp-texte-doux">
        {t(
          "Le QR code n'a pas pu être affiché : saisissez la clé ci-dessous dans votre application.",
          "The QR code could not be displayed: enter the key below in your app.",
        )}
      </p>
    );
  }
  const cote = qr.taille + 8;
  return (
    <svg
      className="mp-qrcode"
      viewBox={`0 0 ${cote} ${cote}`}
      role="img"
      aria-label={t(
        "QR code à scanner avec votre application d'authentification",
        "QR code to scan with your authenticator app",
      )}
      shapeRendering="crispEdges"
    >
      <rect width={cote} height={cote} fill="#ffffff" />
      <path d={cheminSvg(qr)} fill="#000000" />
    </svg>
  );
}
