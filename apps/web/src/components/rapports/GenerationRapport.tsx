"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { api } from "../../lib/api";
import {
  cheminGenerationRapport,
  DELAI_GENERATION_MS,
  etatMissionChange,
  FORMATS,
  FORMATS_RAPPORT,
  formaterDuree,
  hrefRapports,
  libelleFormat,
  libelleModele,
  messageAttente,
  messageRapport,
  peutEtreCree,
  reessayable,
  type FormatRapport,
  type NiveauRapport,
  type RapportCree,
} from "../../lib/rapports";
import { FichierJoint } from "../fichiers/FichierJoint";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import { ContenuRapport } from "./ContenuRapport";
import "./rapports.css";

export interface GenerationRapportProps {
  missionId: string;
  /** Niveau que les droits de l'utilisateur donneront au rapport (affichage seulement). */
  niveau: NiveauRapport;
  cloturee: boolean;
  /** La liste affichée est la première page : sinon, on y revient pour voir le nouveau rapport. */
  premierePage: boolean;
}

interface Echec {
  format: FormatRapport;
  message: string;
  /** La réponse s'est perdue : le rapport existe peut-être, actualiser avant de relancer. */
  actualiser: boolean;
  /** Refus momentané (rendu occupé, délai de rendu) : relancer tel quel. */
  reessayer: boolean;
}

/**
 * Génération du rapport « État d'avancement » (POST /api/missions/:id/rapports) : choix du
 * format, contenu annoncé selon les droits, attente annoncée aux lecteurs d'écran par paliers
 * (le PDF peut prendre jusqu'à 30 s), un seul envoi à la fois (verrou synchrone en plus du
 * bouton désactivé), erreurs en français focalisées, lien de téléchargement du rapport créé.
 * Rien n'est conservé dans le navigateur : le résultat ne vit que dans l'état de la page.
 */
export function GenerationRapport({
  missionId,
  niveau,
  cloturee,
  premierePage,
}: GenerationRapportProps) {
  const router = useRouter();
  const id = useId();
  const [format, setFormat] = useState<FormatRapport>("pdf");
  const [enCours, setEnCours] = useState<FormatRapport | null>(null);
  const [secondes, setSecondes] = useState(0);
  const [echec, setEchec] = useState<Echec | null>(null);
  const [cree, setCree] = useState<RapportCree | null>(null);
  const [annonce, setAnnonce] = useState("");
  // Un double clic arrive avant que React n'ait désactivé le bouton : verrou synchrone.
  const verrou = useRef(false);
  const refErreur = useRef<HTMLDivElement>(null);
  const refSucces = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!enCours) return;
    const debut = Date.now();
    setSecondes(0);
    const minuterie = setInterval(() => setSecondes((Date.now() - debut) / 1000), 1000);
    return () => clearInterval(minuterie);
  }, [enCours]);

  const attente = enCours ? messageAttente(enCours, secondes) : null;
  // Le message ne change qu'à quelques paliers : l'annonce reste rare.
  useEffect(() => {
    if (attente) setAnnonce(attente);
  }, [attente]);

  // Le bouton désactivé a perdu le focus : il va au résultat (succès ou erreur).
  useEffect(() => {
    if (echec) refErreur.current?.focus();
  }, [echec]);
  useEffect(() => {
    if (cree) refSucces.current?.focus();
  }, [cree]);

  async function generer(f: FormatRapport) {
    if (verrou.current || cloturee) return;
    verrou.current = true;
    setEchec(null);
    setCree(null);
    setEnCours(f);
    try {
      const r = await api.post<RapportCree>(cheminGenerationRapport(missionId, f), undefined, {
        delaiMs: DELAI_GENERATION_MS,
      });
      setAnnonce("");
      setCree(r);
      if (premierePage) router.refresh();
      else router.push(hrefRapports(missionId));
    } catch (e) {
      setAnnonce("");
      setEchec({
        format: f,
        message: messageRapport(e),
        actualiser: peutEtreCree(e),
        reessayer: reessayable(e),
      });
      if (etatMissionChange(e)) router.refresh();
    } finally {
      verrou.current = false;
      setEnCours(null);
    }
  }

  function actualiser() {
    setEchec(null);
    setAnnonce("Actualisation de la liste des rapports.");
    if (premierePage) router.refresh();
    else router.push(hrefRapports(missionId));
  }

  const idCloturee = `${id}-cloturee`;
  const occupe = enCours !== null;

  return (
    <div className="mp-rapport-generation">
      {/* Zone d'annonce permanente (montée dès l'affichage pour être lue de façon fiable). */}
      <p className="mp-visuellement-cache" role="status">
        {annonce}
      </p>

      {cloturee ? (
        <Alerte tonalite="info" titre="Mission clôturée" annonce="aucune">
          <p id={idCloturee}>
            La génération de rapports est désactivée : une mission clôturée n&apos;évolue plus. Les
            rapports déjà générés restent téléchargeables ci-dessous.
          </p>
        </Alerte>
      ) : (
        <ContenuRapport niveau={niveau} />
      )}

      <fieldset className="mp-groupe" disabled={cloturee || occupe}>
        <legend className="mp-champ__libelle">Format du document</legend>
        <div className="mp-groupe__options mp-rapport-generation__formats">
          {FORMATS_RAPPORT.map((f) => (
            <div key={f} className="mp-case">
              <input
                type="radio"
                className="mp-case__controle"
                id={`${id}-${f}`}
                name={`${id}-format`}
                value={f}
                checked={format === f}
                onChange={() => setFormat(f)}
                aria-describedby={`${id}-${f}-aide`}
              />
              <label htmlFor={`${id}-${f}`} className="mp-case__libelle">
                {FORMATS[f].libelle}
                <span id={`${id}-${f}-aide`} className="mp-case__aide">
                  {FORMATS[f].aide}
                </span>
              </label>
            </div>
          ))}
        </div>
      </fieldset>

      <div className="mp-actions-formulaire">
        <Bouton
          icone="plus"
          chargement={occupe}
          texteChargement="Génération en cours…"
          disabled={cloturee}
          aria-describedby={cloturee ? idCloturee : undefined}
          onClick={() => void generer(format)}
        >
          Générer l&apos;état d&apos;avancement
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
                <Bouton variante="secondaire" icone="historique" onClick={actualiser}>
                  Actualiser la liste
                </Bouton>
              ) : null}
              {echec.reessayer && !cloturee ? (
                <Bouton
                  variante="secondaire"
                  onClick={() => void generer(echec.format)}
                  aria-label={`Réessayer la génération au format ${FORMATS[echec.format].court}`}
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
          <p>
            {`${libelleModele(cree.rapport.modele)} au format ${libelleFormat(cree.rapport.format)}, au statut « Brouillon » : relisez-le avant toute diffusion. Il figure aussi dans la liste ci-dessous.`}
          </p>
          <FichierJoint fichier={cree.fichier} contexte="(rapport qui vient d'être généré)" />
        </Alerte>
      ) : null}
    </div>
  );
}
