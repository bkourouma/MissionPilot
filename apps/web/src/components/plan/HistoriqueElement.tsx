"use client";

import { useId, useState } from "react";
import type { TypeElementPlan } from "@missionpilot/shared";
import { api } from "../../lib/api";
import type { Devise } from "../../lib/format";
import { nomPersonnePlan, texteElement, type PersonnePlan } from "../../lib/plan-elements";
import {
  cheminHistorique,
  libelleVersionElement,
  messagePlan,
  type PageHistoriqueElement,
  type VersionElementPlan,
} from "../../lib/plan-strategique";
import { DiffTexteIa } from "../ia/DiffTexteIa";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import { BadgeRetire, BadgeStatutPlan } from "./BadgeStatutPlan";

/** Versions chargées par page (la liste de l'API est paginée par curseur). */
const TAILLE_PAGE = 10;

export interface HistoriqueElementProps {
  planId: string;
  elementId: string;
  type: TypeElementPlan;
  devise: Devise;
  personnes: readonly PersonnePlan[];
}

/**
 * Historique des versions d'un contenu (ajout seul), de la plus récente à la plus ancienne,
 * chargé à l'ouverture puis page par page. Chaque version se compare à la précédente (ajouts
 * soulignés, retraits barrés, composant `DiffTexteIa`). Rien n'est conservé dans le navigateur.
 */
export function HistoriqueElement({
  planId,
  elementId,
  type,
  devise,
  personnes,
}: HistoriqueElementProps) {
  const t = useT();
  const langue = useLangue();
  const base = useId();
  const [versions, setVersions] = useState<VersionElementPlan[]>([]);
  const [curseur, setCurseur] = useState<string | null>(null);
  const [charge, setCharge] = useState(false);
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [ouverte, setOuverte] = useState<number | null>(null);

  const texte = (v: VersionElementPlan) =>
    `${v.retire ? t("Retiré du plan.", "Removed from the plan.") + "\n\n" : ""}${texteElement(
      type,
      v.donnees,
      {
        devise,
        nomResponsable: (id) => nomPersonnePlan(id, personnes, langue),
        langue,
      },
    )}`;

  async function charger(suite: string | null) {
    setEnCours(true);
    setErreur(null);
    try {
      const page = await api.get<PageHistoriqueElement>(
        cheminHistorique(planId, elementId, TAILLE_PAGE, suite),
      );
      setVersions((v) => (suite ? [...v, ...page.elements] : page.elements));
      setCurseur(page.curseur_suivant);
      setCharge(true);
    } catch (e) {
      setErreur(messagePlan(e, "lire", langue));
    } finally {
      setEnCours(false);
    }
  }

  return (
    <details
      className="mp-details"
      onToggle={(e) => {
        if ((e.currentTarget as HTMLDetailsElement).open && !charge && !enCours) void charger(null);
      }}
    >
      <summary>{t("Historique des versions", "Version history")}</summary>
      <div className="mp-plan__section">
        {enCours ? (
          <p className="mp-texte-doux" role="status">
            {t("Chargement de l'historique…", "Loading history…")}
          </p>
        ) : null}
        {erreur ? (
          <Alerte
            tonalite="danger"
            titre={t("L'historique n'a pas pu être chargé.", "The history could not be loaded.")}
          >
            <p>{erreur}</p>
            <Bouton variante="secondaire" onClick={() => void charger(charge ? curseur : null)}>
              {t("Réessayer", "Try again")}
            </Bouton>
          </Alerte>
        ) : null}
        {charge && versions.length > 0 ? (
          <ol
            className="mp-plan-historique"
            aria-label={t(
              "Versions, de la plus récente à la plus ancienne",
              "Versions, from newest to oldest",
            )}
          >
            {versions.map((v, i) => {
              const precedente = versions[i + 1];
              const ouvert = ouverte === v.version;
              const idDetail = `${base}-v${v.version}`;
              return (
                <li key={v.version} className="mp-plan-historique__version">
                  <div className="mp-plan-historique__ligne">
                    <BadgeStatutPlan statut={v.statut_contenu} />
                    {v.retire ? <BadgeRetire /> : null}
                    <span>{libelleVersionElement(v, langue)}</span>
                    <Bouton
                      variante="discret"
                      aria-expanded={ouvert}
                      aria-controls={idDetail}
                      onClick={() => setOuverte(ouvert ? null : v.version)}
                    >
                      {precedente
                        ? t(
                            `${ouvert ? "Masquer" : "Comparer avec"} la version ${precedente.version}`,
                            `${ouvert ? "Hide" : "Compare with"} version ${precedente.version}`,
                          )
                        : ouvert
                          ? t("Masquer le contenu", "Hide content")
                          : t("Afficher le contenu", "Show content")}
                    </Bouton>
                  </div>
                  <div id={idDetail} hidden={!ouvert}>
                    {ouvert ? (
                      precedente ? (
                        <DiffTexteIa avant={texte(precedente)} apres={texte(v)} />
                      ) : (
                        <p className="mp-contenu-ia__texte">{texte(v)}</p>
                      )
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
        ) : null}
        {charge && versions.length === 0 && !erreur ? (
          <p className="mp-texte-doux">{t("Aucune version à afficher.", "No versions to show.")}</p>
        ) : null}
        {curseur ? (
          <div>
            <Bouton
              variante="secondaire"
              chargement={enCours}
              texteChargement={t("Chargement…", "Loading…")}
              onClick={() => void charger(curseur)}
            >
              {t("Afficher les versions plus anciennes", "Show older versions")}
            </Bouton>
          </div>
        ) : null}
        {charge && !curseur && versions.length > 0 ? (
          <p className="mp-texte-doux mp-texte-petit">
            {t(
              "Historique complet : les versions ne se modifient ni ne se suppriment.",
              "Complete history: versions can be neither edited nor deleted.",
            )}
          </p>
        ) : null}
      </div>
    </details>
  );
}
