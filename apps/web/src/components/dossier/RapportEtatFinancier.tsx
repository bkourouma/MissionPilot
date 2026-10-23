"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { api, messageErreur } from "../../lib/api";
import { formaterDateHeure } from "../../lib/format";
import {
  COMMENTAIRE_MAX,
  compteurCommentaire,
  construireDemande,
  EXERCICES_DEFAUT,
  EXERCICES_MAX,
  EXERCICES_MIN,
  cheminMissionsClient,
  filtrerEtatsFinanciers,
  FORMATS_ETAT_FINANCIER,
  FORMATS_ETAT_FINANCIER_LIBELLES,
  longueurCommentaire,
  messageEtatFinancier,
  missionsGenerables,
  type ErreursDemande,
  type FormatEtatFinancier,
  type MissionChoix,
} from "../../lib/rapport-etat-financier";
import {
  cheminListeRapports,
  DELAI_GENERATION_MS,
  formaterDuree,
  libelleFormat,
  libelleStatutRapport,
  messageAttente,
  peutEtreCree,
  reessayable,
  type PageRapports,
  type RapportCree,
  type RapportMission,
} from "../../lib/rapports";
import { BadgeNiveau } from "../rapports/BadgeNiveau";
import { FichierJoint } from "../fichiers/FichierJoint";
import { Alerte } from "../ui/Alerte";
import { BadgeStatut } from "../ui/BadgeStatut";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";
import { ZoneTexte } from "../ui/ZoneTexte";
import "../rapports/rapports.css";

interface Echec {
  message: string;
  actualiser: boolean;
  reessayer: boolean;
}

/**
 * Carte « Rapport d'état financier » du dossier client : mission de rattachement (non
 * clôturée), format, nombre d'exercices, commentaire facultatif du consultant. Les chiffres
 * viennent du moteur de calcul, jamais de cette interface. Le fichier généré est un brouillon à
 * relire ; son téléchargement passe par le lien authentifié (l'API revérifie les droits).
 */
export function RapportEtatFinancier({ clientId }: { clientId: string }) {
  const cle = useId();
  const [missions, setMissions] = useState<MissionChoix[] | null>(null);
  const [erreurMissions, setErreurMissions] = useState<string | null>(null);
  const [missionId, setMissionId] = useState("");
  const [format, setFormat] = useState<FormatEtatFinancier>("pdf");
  const [exercices, setExercices] = useState(String(EXERCICES_DEFAUT));
  const [commentaire, setCommentaire] = useState("");
  const [erreurs, setErreurs] = useState<ErreursDemande>({});
  const [enCours, setEnCours] = useState(false);
  const [secondes, setSecondes] = useState(0);
  const [echec, setEchec] = useState<Echec | null>(null);
  const [cree, setCree] = useState<RapportCree | null>(null);
  const [annonce, setAnnonce] = useState("");
  const [liste, setListe] = useState<RapportMission[] | null>(null);
  const [erreurListe, setErreurListe] = useState<string | null>(null);
  const verrou = useRef(false);
  const refErreur = useRef<HTMLDivElement>(null);
  const refSucces = useRef<HTMLDivElement>(null);

  const chargerMissions = useCallback(async () => {
    setErreurMissions(null);
    setMissions(null);
    try {
      const page = await api.get<{ elements: (MissionChoix & { client_id?: string })[] }>(
        cheminMissionsClient(clientId),
      );
      const l = missionsGenerables(page.elements);
      setMissions(l);
      setMissionId((courant) => (l.some((m) => m.id === courant) ? courant : (l[0]?.id ?? "")));
    } catch (e) {
      setErreurMissions(messageErreur(e));
    }
  }, [clientId]);

  useEffect(() => {
    void chargerMissions();
  }, [chargerMissions]);

  const chargerListe = useCallback(async () => {
    if (!missionId) {
      setListe(null);
      return;
    }
    setListe(null);
    try {
      const page = await api.get<PageRapports>(cheminListeRapports(missionId));
      setListe(filtrerEtatsFinanciers(page.elements));
      setErreurListe(null);
    } catch (e) {
      setErreurListe(messageErreur(e));
    }
  }, [missionId]);

  useEffect(() => {
    void chargerListe();
  }, [chargerListe]);

  useEffect(() => {
    if (!enCours) return;
    const debut = Date.now();
    setSecondes(0);
    const minuterie = setInterval(() => setSecondes((Date.now() - debut) / 1000), 1000);
    return () => clearInterval(minuterie);
  }, [enCours]);

  const attente = enCours ? messageAttente(format, secondes) : null;
  useEffect(() => {
    if (attente) setAnnonce(attente);
  }, [attente]);
  useEffect(() => {
    if (echec) refErreur.current?.focus();
  }, [echec]);
  useEffect(() => {
    if (cree) refSucces.current?.focus();
  }, [cree]);

  async function generer() {
    if (verrou.current) return;
    const demande = construireDemande(clientId, { missionId, format, exercices, commentaire });
    if (!demande.ok) {
      setErreurs(demande.erreurs);
      return;
    }
    setErreurs({});
    verrou.current = true;
    setEchec(null);
    setCree(null);
    setEnCours(true);
    try {
      const r = await api.post<RapportCree>(demande.chemin, demande.corps, {
        delaiMs: DELAI_GENERATION_MS,
      });
      setAnnonce("");
      setCree(r);
      void chargerListe();
    } catch (e) {
      setAnnonce("");
      setEchec({
        message: messageEtatFinancier(e),
        actualiser: peutEtreCree(e),
        reessayer: reessayable(e),
      });
    } finally {
      verrou.current = false;
      setEnCours(false);
    }
  }

  const aucuneMission = missions !== null && missions.length === 0;
  const idAide = `${cle}-aide`;
  const nbCaracteres = longueurCommentaire(commentaire);

  return (
    <div className="mp-rapport-generation">
      <p className="mp-visuellement-cache" role="status">
        {annonce}
      </p>

      <p id={idAide} className="mp-texte-doux">
        Le rapport reprend les états financiers acceptés du dossier. Les chiffres du rapport
        viennent du moteur de calcul ; votre commentaire est ajouté tel quel. Le rapport est
        confidentiel et reste un brouillon à relire avant diffusion.
      </p>

      {erreurMissions ? (
        <Alerte tonalite="attention" titre="Missions indisponibles" annonce="aucune">
          <p>{erreurMissions}</p>
          <Bouton variante="secondaire" icone="historique" onClick={() => void chargerMissions()}>
            Réessayer
          </Bouton>
        </Alerte>
      ) : missions === null ? (
        <p className="mp-texte-doux">Chargement des missions du client…</p>
      ) : aucuneMission ? (
        <Alerte tonalite="info" titre="Aucune mission ouverte" annonce="aucune">
          <p>
            Ce client n&apos;a aucune mission non clôturée : un rapport est toujours rattaché à une
            mission en cours. Créez ou rouvrez une mission pour générer le rapport.
          </p>
        </Alerte>
      ) : (
        <>
          <Select
            libelle="Mission de rattachement"
            aide="Le rapport est rangé dans les rapports de cette mission."
            options={missions.map((m) => ({ valeur: m.id, libelle: m.intitule }))}
            value={missionId}
            onChange={(e) => setMissionId(e.target.value)}
            disabled={enCours}
            erreur={erreurs.mission}
            required
          />

          <fieldset className="mp-groupe" disabled={enCours}>
            <legend className="mp-champ__libelle">Format du document</legend>
            <div className="mp-groupe__options mp-rapport-generation__formats">
              {FORMATS_ETAT_FINANCIER.map((f) => (
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
                    {FORMATS_ETAT_FINANCIER_LIBELLES[f].libelle}
                    <span id={`${cle}-${f}-aide`} className="mp-case__aide">
                      {FORMATS_ETAT_FINANCIER_LIBELLES[f].aide}
                    </span>
                  </label>
                </div>
              ))}
            </div>
          </fieldset>

          <Champ
            libelle="Nombre d'exercices"
            aide={`Les exercices acceptés les plus récents, de ${EXERCICES_MIN} à ${EXERCICES_MAX}.`}
            type="number"
            inputMode="numeric"
            min={EXERCICES_MIN}
            max={EXERCICES_MAX}
            step={1}
            value={exercices}
            onChange={(e) => setExercices(e.target.value)}
            disabled={enCours}
            erreur={erreurs.exercices}
            required
          />

          <ZoneTexte
            libelle="Commentaire du consultant (facultatif, 4000 caractères)"
            aide={
              <>
                Les chiffres du rapport viennent du moteur de calcul ; votre commentaire est ajouté
                tel quel. <span aria-live="polite">{compteurCommentaire(commentaire)}</span>
              </>
            }
            rows={5}
            value={commentaire}
            onChange={(e) => setCommentaire(e.target.value)}
            disabled={enCours}
            erreur={
              erreurs.commentaire ??
              (nbCaracteres > COMMENTAIRE_MAX
                ? `Le commentaire est limité à ${COMMENTAIRE_MAX} caractères.`
                : undefined)
            }
          />

          <div className="mp-actions-formulaire">
            <Bouton
              icone="telechargement"
              chargement={enCours}
              texteChargement="Génération en cours…"
              aria-describedby={idAide}
              onClick={() => void generer()}
            >
              Générer le rapport
            </Bouton>
          </div>
        </>
      )}

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
                <Bouton
                  variante="secondaire"
                  icone="historique"
                  onClick={() => void chargerListe()}
                >
                  Actualiser la liste
                </Bouton>
              ) : null}
              {echec.reessayer ? (
                <Bouton variante="secondaire" onClick={() => void generer()}>
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
            Brouillon à relire avant diffusion. Rapport confidentiel : téléchargez-le ci-dessous.
          </p>
          <FichierJoint fichier={cree.fichier} contexte="(rapport qui vient d'être généré)" />
        </Alerte>
      ) : null}

      {missionId ? (
        <section aria-labelledby={`${cle}-liste`} className="mp-pile">
          <h3 id={`${cle}-liste`} className="mp-rapport-contenu__titre">
            Rapports déjà générés pour cette mission
          </h3>
          {erreurListe ? (
            <Alerte tonalite="attention" titre="Liste indisponible" annonce="aucune">
              <p>{erreurListe}</p>
              <Bouton variante="secondaire" icone="historique" onClick={() => void chargerListe()}>
                Réessayer
              </Bouton>
            </Alerte>
          ) : liste === null ? (
            <p className="mp-texte-doux">Chargement des rapports…</p>
          ) : liste.length === 0 ? (
            <p className="mp-texte-doux">Aucun rapport d&apos;état financier pour le moment.</p>
          ) : (
            <ul className="mp-liste-lignes" aria-label="Rapports d'état financier générés">
              {liste.map((r) => {
                const date = formaterDateHeure(r.genere_le);
                return (
                  <li key={r.id} className="mp-liste-lignes__ligne mp-rapport">
                    <div className="mp-rapport__texte">
                      <p className="mp-rapport__titre">{`Rapport d'état financier du ${date}`}</p>
                      <BadgeStatut tonalite={r.statut === "valide" ? "succes" : "neutre"} sansIcone>
                        {libelleStatutRapport(r.statut)}
                      </BadgeStatut>
                      <BadgeNiveau niveau={r.niveau} />
                      <FichierJoint
                        fichier={r.fichier}
                        contexte={`(${date}, ${libelleFormat(r.format)})`}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}
