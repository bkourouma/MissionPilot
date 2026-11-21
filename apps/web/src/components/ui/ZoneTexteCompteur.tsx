"use client";

import { useEffect, useState } from "react";
import { useT } from "../i18n/FournisseurLangue";
import { etatCompteur } from "./ZoneTexte.aide";

interface Props {
  /** Identifiant de la zone de texte suivie. */
  idZone: string;
  max?: number;
  /** Zone contrôlée : longueur connue du parent (pas d'écoute du DOM). */
  longueurControlee?: number;
  /** Longueur initiale (valeur par défaut d'une zone non contrôlée). */
  longueurInitiale: number;
}

/**
 * Compteur « 120 / 500 ». Le total visible est masqué aux lecteurs d'écran (sinon chaque frappe
 * serait annoncée) ; le nombre de caractères restants est annoncé seulement près de la limite.
 */
export function ZoneTexteCompteur({ idZone, max, longueurControlee, longueurInitiale }: Props) {
  const t = useT();
  const [longueurDom, setLongueurDom] = useState(longueurInitiale);

  useEffect(() => {
    if (longueurControlee !== undefined) return;
    const zone = document.getElementById(idZone);
    if (!(zone instanceof HTMLTextAreaElement)) return;
    const maj = () => setLongueurDom(zone.value.length);
    maj();
    zone.addEventListener("input", maj);
    // Réinitialisation du formulaire : l'événement « reset » précède la remise de la valeur.
    const formulaire = zone.form;
    const apresReset = () => {
      setTimeout(maj, 0);
    };
    formulaire?.addEventListener("reset", apresReset);
    return () => {
      zone.removeEventListener("input", maj);
      formulaire?.removeEventListener("reset", apresReset);
    };
  }, [idZone, longueurControlee]);

  const etat = etatCompteur(longueurControlee ?? longueurDom, max);
  const classes = [
    "mp-zone-texte__compteur",
    etat.proche ? "mp-zone-texte__compteur--proche" : "",
    etat.atteint ? "mp-zone-texte__compteur--atteint" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <p className={classes}>
      <span aria-hidden="true">
        {max === undefined
          ? t(`${etat.longueur} caractères`, `${etat.longueur} characters`)
          : `${etat.longueur} / ${max}`}
      </span>
      <span className="mp-visuellement-cache" role="status">
        {etat.proche && etat.restants !== undefined
          ? etat.atteint
            ? t("Limite de caractères atteinte", "Character limit reached")
            : t(`${etat.restants} caractères restants`, `${etat.restants} characters left`)
          : ""}
      </span>
    </p>
  );
}
