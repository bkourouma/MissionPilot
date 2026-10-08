"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { api } from "../../lib/api";
import { formaterDateHeure } from "../../lib/format";
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
  FORMATS_LIVRABLE,
  FORMATS_LIVRABLE_LIBELLES,
  libelleFormatLivrable,
  libelleStatutLivrable,
  LIVRABLES,
  messageLivrable,
  messageLivrableCree,
  type FormatLivrable,
  type LivrableCree,
  type PageLivrables,
  type RapportLivrable,
  type TypeLivrable,
} from "./livrables";
import "./rapports.css";

export interface GenerationLivrableProps {
  /** « notation » : rapport de la notation publiée ; « plan » : rapport du plan stratégique. */
  type: TypeLivrable;
  /** Identifiant de la notation ou du plan. */
  id: string;
  /** Mission clôturée : génération désactivée, rapports existants toujours listés. */
  cloturee?: boolean;
  /**
   * Version à rendre (notation : version publiée ; plan : version du modèle financier).
   * Absente : la dernière publiée (notation), la dernière validée sinon la dernière (plan).
   */
  version?: number | null;
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
}: GenerationLivrableProps) {
  const cle = useId();
  const config = LIVRABLES[type];
  const [format, setFormat] = useState<FormatLivrable>("pdf");
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
      setListe(page.elements);
      setErreurListe(null);
    } catch (e) {
      setErreurListe(messageLivrable(type, e));
    }
  }, [type, id]);

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

  const attente = enCours ? messageAttente(enCours, secondes) : null;
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
    if (verrou.current || cloturee) return;
    verrou.current = true;
    setEchec(null);
    setCree(null);
    setEnCours(f);
    try {
      const r = await api.post<LivrableCree>(
        cheminGenerationLivrable(type, id, f, version),
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
        message: messageLivrable(type, e),
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

      {cloturee ? (
        <Alerte tonalite="info" titre="Mission clôturée" annonce="aucune">
          <p id={idAide}>
            La génération est désactivée : une mission clôturée n&apos;évolue plus. Les rapports
            déjà générés restent téléchargeables ci-dessous.
          </p>
        </Alerte>
      ) : (
        <p id={idAide} className="mp-texte-doux">
          {config.explication}
        </p>
      )}

      <fieldset className="mp-groupe" disabled={cloturee || occupe}>
        <legend className="mp-champ__libelle">Format du document</legend>
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
                {FORMATS_LIVRABLE_LIBELLES[f].libelle}
                <span id={`${cle}-${f}-aide`} className="mp-case__aide">
                  {FORMATS_LIVRABLE_LIBELLES[f].aide}
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
          texteChargement="Génération en cours…"
          disabled={cloturee}
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
            {`Temps écoulé : ${formaterDuree(secondes)}`}
          </p>
        </div>
      ) : null}

      {echec ? (
        <Alerte ref={refErreur} tonalite="danger" titre="Génération impossible">
          <p>{echec.message}</p>
          {echec.actualiser || echec.reessayer ? (
            <div className="mp-barre-actions mp-barre-actions--compacte">
              {echec.actualiser ? (
                <Bouton variante="secondaire" icone="historique" onClick={() => void charger()}>
                  Actualiser la liste
                </Bouton>
              ) : null}
              {echec.reessayer && !cloturee ? (
                <Bouton
                  variante="secondaire"
                  onClick={() => void generer(echec.format)}
                  aria-label={`Réessayer la génération au format ${FORMATS_LIVRABLE_LIBELLES[echec.format].libelle}`}
                >
                  Réessayer
                </Bouton>
              ) : null}
            </div>
          ) : null}
        </Alerte>
      ) : null}

      {cree ? (
        <Alerte ref={refSucces} tonalite="succes" titre="Rapport généré" annonce="aucune">
          <p>{messageLivrableCree(type, cree)}</p>
          <FichierJoint fichier={cree.fichier} contexte="(rapport qui vient d'être généré)" />
        </Alerte>
      ) : null}

      <section aria-labelledby={`${cle}-liste`} className="mp-pile">
        <h3 id={`${cle}-liste`} className="mp-rapport-contenu__titre">
          Rapports déjà générés
        </h3>
        {erreurListe ? (
          <Alerte tonalite="attention" titre="Liste indisponible" annonce="aucune">
            <p>{erreurListe}</p>
            <Bouton variante="secondaire" icone="historique" onClick={() => void charger()}>
              Réessayer
            </Bouton>
          </Alerte>
        ) : liste === null ? (
          <p className="mp-texte-doux">Chargement des rapports…</p>
        ) : liste.length === 0 ? (
          <p className="mp-texte-doux">Aucun rapport généré pour le moment.</p>
        ) : (
          <ul className="mp-liste-lignes" aria-label={`${config.titre} : rapports générés`}>
            {liste.map((r) => {
              const date = formaterDateHeure(r.genere_le);
              const formatLibelle = libelleFormatLivrable(r.format);
              return (
                <li key={r.id} className="mp-liste-lignes__ligne mp-rapport">
                  <div className="mp-rapport__texte">
                    <p className="mp-rapport__titre">
                      {`${config.titre} du ${date}`}
                      {r.version_source
                        ? ` — ${config.version.toLowerCase()} ${r.version_source}`
                        : ""}
                    </p>
                    <BadgeStatut tonalite={r.statut === "valide" ? "succes" : "neutre"} sansIcone>
                      {libelleStatutLivrable(r.statut)}
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
