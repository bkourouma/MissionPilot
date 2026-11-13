"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { api } from "../../lib/api";
import { formaterDateHeure } from "../../lib/format";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import {
  DELAI_GENERATION_MS,
  formaterDuree,
  messageAttente,
  peutEtreCree,
  reessayable,
} from "../../lib/rapports";
import { FichierJoint } from "../fichiers/FichierJoint";
import { Alerte } from "../ui/Alerte";
import { BadgeStatut } from "../ui/BadgeStatut";
import { Bouton } from "../ui/Bouton";
import {
  cheminGenerationLivrable,
  cheminListeLivrables,
  avecVariante,
  filtrerLivrables,
  FORMATS_LIVRABLE,
  formatLivrable,
  libelleFormatLivrable,
  libelleStatutLivrable,
  VARIANTES_LIVRABLE,
  varianteLivrable,
  livrable,
  messageLivrable,
  messageLivrableCree,
  type FormatLivrable,
  type LivrableCree,
  type PageLivrables,
  type RapportLivrable,
  type TypeLivrable,
  type VarianteLivrable,
} from "./livrables";
import "./rapports.css";

export interface GenerationLivrableProps {
  /**
   * « notation » : rapport de la notation publiée ; « plan » : rapport du plan stratégique ;
   * « dossier_bancaire » : dossier bancaire d'un plan.
   */
  type: TypeLivrable;
  /** Identifiant de la notation ou du plan. */
  id: string;
  /** Mission clôturée : génération désactivée, rapports existants toujours listés. */
  cloturee?: boolean;
  /**
   * Version à rendre (notation : version publiée ; plan et dossier bancaire : version du modèle
   * financier).
   * Absente : la dernière publiée (notation), la dernière validée sinon la dernière (plan).
   */
  version?: number | null;
  /**
   * Génération impossible pour une raison métier connue d'avance (par exemple note sans version
   * validée) : le message est affiché à la place de l'explication et le bouton est désactivé.
   */
  indisponible?: string;
}

interface Echec {
  format: FormatLivrable;
  message: string;
  actualiser: boolean;
  reessayer: boolean;
}

/**
 * Panneau réutilisable de génération et de téléchargement d'un rapport de service (notation
 * publiée ou plan stratégique) : choix PDF ou Word, attente annoncée par paliers, un seul envoi
 * à la fois, erreurs en français focalisées, liens authentifiés vers les rapports déjà
 * générés (les plus récents, revérifiés par l'API à chaque téléchargement).
 */
export function GenerationLivrable({
  type,
  id,
  cloturee = false,
  version,
  indisponible,
}: GenerationLivrableProps) {
  const t = useT();
  const langue = useLangue();
  const cle = useId();
  const config = livrable(type, langue);
  const [format, setFormat] = useState<FormatLivrable>("pdf");
  const [variante, setVariante] = useState<VarianteLivrable>("executive");
  const [enCours, setEnCours] = useState<FormatLivrable | null>(null);
  const [secondes, setSecondes] = useState(0);
  const [echec, setEchec] = useState<Echec | null>(null);
  const [cree, setCree] = useState<LivrableCree | null>(null);
  const [annonce, setAnnonce] = useState("");
  const [liste, setListe] = useState<RapportLivrable[] | null>(null);
  const [erreurListe, setErreurListe] = useState<string | null>(null);
  const verrou = useRef(false);
  const refErreur = useRef<HTMLDivElement>(null);
  const refSucces = useRef<HTMLDivElement>(null);

  const charger = useCallback(async () => {
    try {
      const page = await api.get<PageLivrables>(cheminListeLivrables(type, id));
      setListe(filtrerLivrables(type, page.elements));
      setErreurListe(null);
    } catch (e) {
      setErreurListe(messageLivrable(type, e, langue));
    }
  }, [type, id, langue]);

  useEffect(() => {
    void charger();
  }, [charger]);

  useEffect(() => {
    if (!enCours) return;
    const debut = Date.now();
    setSecondes(0);
    const minuterie = setInterval(() => setSecondes((Date.now() - debut) / 1000), 1000);
    return () => clearInterval(minuterie);
  }, [enCours]);

  const attente = enCours ? messageAttente(enCours, secondes, langue) : null;
  useEffect(() => {
    if (attente) setAnnonce(attente);
  }, [attente]);
  useEffect(() => {
    if (echec) refErreur.current?.focus();
  }, [echec]);
  useEffect(() => {
    if (cree) refSucces.current?.focus();
  }, [cree]);

  async function generer(f: FormatLivrable) {
    if (verrou.current || cloturee || indisponible) return;
    verrou.current = true;
    setEchec(null);
    setCree(null);
    setEnCours(f);
    try {
      const r = await api.post<LivrableCree>(
        cheminGenerationLivrable(type, id, f, version, variante),
        undefined,
        { delaiMs: DELAI_GENERATION_MS },
      );
      setAnnonce("");
      setCree(r);
      void charger();
    } catch (e) {
      setAnnonce("");
      setEchec({
        format: f,
        message: messageLivrable(type, e, langue),
        actualiser: peutEtreCree(e),
        reessayer: reessayable(e),
      });
    } finally {
      verrou.current = false;
      setEnCours(null);
    }
  }

  const occupe = enCours !== null;
  const idAide = `${cle}-aide`;

  return (
    <div className="mp-rapport-generation">
      <p className="mp-visuellement-cache" role="status">
        {annonce}
      </p>

      {indisponible ? (
        <Alerte
          tonalite="info"
          titre={t("Rapport indisponible", "Report unavailable")}
          annonce="aucune"
        >
          <p id={idAide}>{indisponible}</p>
        </Alerte>
      ) : cloturee ? (
        <Alerte tonalite="info" titre={t("Mission clôturée", "Engagement closed")} annonce="aucune">
          <p id={idAide}>
            {t(
              "La génération est désactivée : une mission clôturée n'évolue plus. Les rapports déjà générés restent téléchargeables ci-dessous.",
              "Generation is disabled: a closed engagement no longer changes. Reports already generated remain downloadable below.",
            )}
          </p>
        </Alerte>
      ) : (
        <p id={idAide} className="mp-texte-doux">
          {config.explication}
        </p>
      )}

      {avecVariante(type) ? (
        <fieldset className="mp-groupe" disabled={cloturee || occupe || Boolean(indisponible)}>
          <legend className="mp-champ__libelle">{t("Variante", "Variant")}</legend>
          <div className="mp-groupe__options mp-rapport-generation__formats">
            {VARIANTES_LIVRABLE.map((v) => (
              <div key={v} className="mp-case">
                <input
                  type="radio"
                  className="mp-case__controle"
                  id={`${cle}-v-${v}`}
                  name={`${cle}-variante`}
                  value={v}
                  checked={variante === v}
                  onChange={() => setVariante(v)}
                />
                <label htmlFor={`${cle}-v-${v}`} className="mp-case__libelle">
                  {varianteLivrable(v, langue).libelle}
                  <span className="mp-case__aide">{varianteLivrable(v, langue).aide}</span>
                </label>
              </div>
            ))}
          </div>
        </fieldset>
      ) : null}

      <fieldset className="mp-groupe" disabled={cloturee || occupe || Boolean(indisponible)}>
        <legend className="mp-champ__libelle">{t("Format du document", "Document format")}</legend>
        <div className="mp-groupe__options mp-rapport-generation__formats">
          {FORMATS_LIVRABLE.map((f) => (
            <div key={f} className="mp-case">
              <input
                type="radio"
                className="mp-case__controle"
                id={`${cle}-${f}`}
                name={`${cle}-format`}
                value={f}
                checked={format === f}
                onChange={() => setFormat(f)}
                aria-describedby={`${cle}-${f}-aide`}
              />
              <label htmlFor={`${cle}-${f}`} className="mp-case__libelle">
                {formatLivrable(f, langue).libelle}
                <span id={`${cle}-${f}-aide`} className="mp-case__aide">
                  {formatLivrable(f, langue).aide}
                </span>
              </label>
            </div>
          ))}
        </div>
      </fieldset>

      <div className="mp-actions-formulaire">
        <Bouton
          icone="telechargement"
          chargement={occupe}
          texteChargement={t("Génération en cours…", "Generating…")}
          disabled={cloturee || Boolean(indisponible)}
          aria-describedby={idAide}
          onClick={() => void generer(format)}
        >
          {config.bouton}
        </Bouton>
      </div>

      {enCours ? (
        <div className="mp-rapport-attente">
          <p className="mp-rapport-attente__message">{attente}</p>
          <progress className="mp-rapport-attente__barre" aria-hidden="true" />
          <p className="mp-texte-doux mp-texte-petit">
            {`${t("Temps écoulé :", "Elapsed time:")} ${formaterDuree(secondes)}`}
          </p>
        </div>
      ) : null}

      {echec ? (
        <Alerte
          ref={refErreur}
          tonalite="danger"
          titre={t("Génération impossible", "Generation failed")}
        >
          <p>{echec.message}</p>
          {echec.actualiser || echec.reessayer ? (
            <div className="mp-barre-actions mp-barre-actions--compacte">
              {echec.actualiser ? (
                <Bouton variante="secondaire" icone="historique" onClick={() => void charger()}>
                  {t("Actualiser la liste", "Refresh the list")}
                </Bouton>
              ) : null}
              {echec.reessayer && !cloturee ? (
                <Bouton
                  variante="secondaire"
                  onClick={() => void generer(echec.format)}
                  aria-label={t(
                    `Réessayer la génération au format ${formatLivrable(echec.format).libelle}`,
                    `Retry generating in ${formatLivrable(echec.format, "en").libelle} format`,
                  )}
                >
                  {t("Réessayer", "Try again")}
                </Bouton>
              ) : null}
            </div>
          ) : null}
        </Alerte>
      ) : null}

      {cree ? (
        <Alerte
          ref={refSucces}
          tonalite="succes"
          titre={t("Rapport généré", "Report generated")}
          annonce="aucune"
        >
          <p>{messageLivrableCree(type, cree, langue)}</p>
          <FichierJoint
            fichier={cree.fichier}
            contexte={t("(rapport qui vient d'être généré)", "(report just generated)")}
          />
        </Alerte>
      ) : null}

      <section aria-labelledby={`${cle}-liste`} className="mp-pile">
        <h3 id={`${cle}-liste`} className="mp-rapport-contenu__titre">
          {t("Rapports déjà générés", "Reports already generated")}
        </h3>
        {erreurListe ? (
          <Alerte
            tonalite="attention"
            titre={t("Liste indisponible", "List unavailable")}
            annonce="aucune"
          >
            <p>{erreurListe}</p>
            <Bouton variante="secondaire" icone="historique" onClick={() => void charger()}>
              {t("Réessayer", "Try again")}
            </Bouton>
          </Alerte>
        ) : liste === null ? (
          <p className="mp-texte-doux">{t("Chargement des rapports…", "Loading reports…")}</p>
        ) : liste.length === 0 ? (
          <p className="mp-texte-doux">
            {t("Aucun rapport généré pour le moment.", "No report generated yet.")}
          </p>
        ) : (
          <ul
            className="mp-liste-lignes"
            aria-label={t(
              `${config.titre} : rapports générés`,
              `${config.titre}: generated reports`,
            )}
          >
            {liste.map((r) => {
              const date = formaterDateHeure(r.genere_le, undefined, langue);
              const formatLibelle = libelleFormatLivrable(r.format, langue);
              return (
                <li key={r.id} className="mp-liste-lignes__ligne mp-rapport">
                  <div className="mp-rapport__texte">
                    <p className="mp-rapport__titre">
                      {`${config.titre}${r.variante ? ` (${varianteLivrable(r.variante, langue).libelle.toLowerCase()})` : ""} ${t("du", "on")} ${date}`}
                      {r.version_source
                        ? ` — ${config.version.toLowerCase()} ${r.version_source}`
                        : ""}
                    </p>
                    <BadgeStatut tonalite={r.statut === "valide" ? "succes" : "neutre"} sansIcone>
                      {libelleStatutLivrable(r.statut, langue)}
                    </BadgeStatut>
                    <FichierJoint fichier={r.fichier} contexte={`(${date}, ${formatLibelle})`} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
