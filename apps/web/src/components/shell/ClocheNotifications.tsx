"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import { libelleCloche, pastilleCloche, type PageNotifications } from "../../lib/notifications";
import { Icone } from "../ui/Icone";

/** Événement émis par la page des notifications après « marquer lue » ou « tout lire ». */
export const EVENEMENT_NOTIFICATIONS = "mp:notifications";

const INTERVALLE_MS = 60_000;

/**
 * Cloche de l'en-tête (SOC-08) : lien vers /notifications dont le nom accessible porte le
 * nombre de notifications non lues. Une hausse du compteur est annoncée poliment. Le compteur
 * est relu à l'affichage, à chaque changement de page, au retour sur l'onglet et chaque minute
 * (onglet visible seulement : économie de données en 3G).
 */
export function ClocheNotifications() {
  const chemin = usePathname();
  const [nonLues, setNonLues] = useState<number | null>(null);
  const [annonce, setAnnonce] = useState("");
  const precedent = useRef<number | null>(null);

  const relire = useCallback(async () => {
    try {
      const r = await api.get<PageNotifications>("/api/notifications?non_lues=true&limite=1", {
        redirigerSi401: false,
        delaiMs: 10_000,
      });
      const n = r.non_lues;
      if (precedent.current !== null && n > precedent.current) {
        setAnnonce(
          n - precedent.current === 1 ? "Nouvelle notification." : "Nouvelles notifications.",
        );
      }
      precedent.current = n;
      setNonLues(n);
    } catch {
      // Hors connexion ou API indisponible : on garde le dernier compteur connu.
    }
  }, []);

  useEffect(() => {
    void relire();
  }, [relire, chemin]);

  useEffect(() => {
    const surVisibilite = () => {
      if (document.visibilityState === "visible") void relire();
    };
    const minuterie = setInterval(() => {
      if (document.visibilityState === "visible") void relire();
    }, INTERVALLE_MS);
    document.addEventListener("visibilitychange", surVisibilite);
    window.addEventListener(EVENEMENT_NOTIFICATIONS, relire);
    window.addEventListener("online", relire);
    return () => {
      clearInterval(minuterie);
      document.removeEventListener("visibilitychange", surVisibilite);
      window.removeEventListener(EVENEMENT_NOTIFICATIONS, relire);
      window.removeEventListener("online", relire);
    };
  }, [relire]);

  const pastille = pastilleCloche(nonLues);
  return (
    <>
      <Link
        href="/notifications"
        className="mp-cloche"
        aria-label={libelleCloche(nonLues)}
        aria-current={chemin === "/notifications" ? "page" : undefined}
      >
        <Icone nom="cloche" taille={22} />
        {pastille ? (
          <span className="mp-cloche__pastille" aria-hidden="true">
            {pastille}
          </span>
        ) : null}
      </Link>
      <span className="mp-visuellement-cache" role="status">
        {annonce}
      </span>
    </>
  );
}
