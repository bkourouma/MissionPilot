"use client";

import { useMemo } from "react";
import { cheminSvg, genererQrCode } from "../../lib/qrcode";

/**
 * QR code de l'URI `otpauth://` généré dans le navigateur (aucun service externe, aucune
 * dépendance) : le secret ne quitte jamais la page. Noir sur blanc quel que soit le thème,
 * pour rester lisible par les appareils photo.
 */
export function QrCodeTotp({ uri }: { uri: string }) {
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
        Le QR code n&apos;a pas pu être affiché : saisissez la clé ci-dessous dans votre
        application.
      </p>
    );
  }
  const cote = qr.taille + 8;
  return (
    <svg
      className="mp-qrcode"
      viewBox={`0 0 ${cote} ${cote}`}
      role="img"
      aria-label="QR code à scanner avec votre application d'authentification"
      shapeRendering="crispEdges"
    >
      <rect width={cote} height={cote} fill="#ffffff" />
      <path d={cheminSvg(qr)} fill="#000000" />
    </svg>
  );
}
