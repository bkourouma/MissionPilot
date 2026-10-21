"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import {
  champsInitiaux,
  cheminApiRapportAvancement,
  corpsModification,
  erreurLongueur,
  estConflitVersion,
  etatCommentaire,
  estFige,
  LIBELLE_BROUILLON_IA,
  LIBELLES_RAISON_SUGGESTION,
  MENTION_BROUILLON_IA,
  messageAvancement,
  modifie,
  raisonValidationImpossible,
  TAILLE_COMMENTAIRE_AVANCEMENT,
  TAILLE_INTRODUCTION_AVANCEMENT,
  type ChampsEdition,
  type RapportAvancement,
  type ReponseSuggestionAvancement,
} from "../../lib/avancement";
import { formaterDateHeure, formaterNombre } from "../../lib/format";
import { BoutonConfirmation } from "../formulaires/BoutonConfirmation";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { Alerte } from "../ui/Alerte";
import { BadgeStatut } from "../ui/BadgeStatut";
import { Bouton } from "../ui/Bouton";
import { Carte } from "../ui/Carte";
import { ZoneTexte } from "../ui/ZoneTexte";
import "./avancement.css";

function Compteur({ valeur, max }: { valeur: string; max: number }) {
  const n = valeur.trim().length;
  return (
    <p className={n > max ? "mp-avc-compteur mp-avc-compteur--depasse" : "mp-avc-compteur"}>
      {`${formaterNombre(n, 0)} / ${formaterNombre(max, 0)} caractères`}
    </p>
  );
}

/** Lecture seule d'un texte du chef de mission (rapport validé). */
function TexteFige({ titre, texte }: { titre: string; texte: string | null }) {
  return (
    <Carte titre={titre} niveauTitre={3}>
      {texte ? (
        <p className="mp-avc-texte">{texte}</p>
      ) : (
        <p className="mp-texte-doux">Non renseigné.</p>
      )}
    </Carte>
  );
}

/**
 * Relecture d'un rapport d'avancement : SEULS l'introduction et le commentaire sont modifiables ;
 * les chiffres (affichés à part, en lecture seule) viennent du moteur. Enregistrer et valider
 * portent la version lue (verrou optimiste) ; un conflit demande de recharger. Un rapport validé
 * est figé. L'API reste seule juge des droits et des états.
 */
export function EditeurRapport({ rapport }: { rapport: RapportAvancement }) {
  const router = useRouter();
  const depart = champsInitiaux(rapport);
  const cle = `${rapport.version}|${rapport.modifie_le}|${rapport.genere_le}`;
  const [cleVue, setCleVue] = useState(cle);
  const [champs, setChamps] = useState<ChampsEdition>(depart);
  const [enCours, setEnCours] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [conflit, setConflit] = useState(false);
  const [succes, setSucces] = useState<string | null>(null);
  const verrou = useRef(false);
  const refAlerte = useRef<HTMLDivElement>(null);

  // Nouvelle version reçue du serveur (après enregistrement, régénération ou rechargement).
  if (cle !== cleVue) {
    setCleVue(cle);
    setChamps(depart);
  }

  useEffect(() => {
    if (erreur) refAlerte.current?.focus();
  }, [erreur]);

  const fige = estFige(rapport);
  const aIA = rapport.statut_commentaire === "brouillon_ia";
  const etat = etatCommentaire(rapport.statut_commentaire);

  if (fige) {
    return (
      <div className="mp-avc">
        <Alerte
          tonalite="succes"
          annonce="aucune"
          titre={`Rapport validé le ${formaterDateHeure(rapport.valide_le)}`}
        >
          <p>
            {rapport.valide_par?.nom ? `Validé par ${rapport.valide_par.nom}. ` : ""}
            Ce rapport est figé : il est visible du client et ne peut plus être modifié.
          </p>
        </Alerte>
        <TexteFige titre="Introduction" texte={rapport.introduction} />
        <TexteFige titre="Commentaire du chef de mission" texte={rapport.commentaire} />
      </div>
    );
  }

  const erreurIntro = erreurLongueur(
    champs.introduction,
    TAILLE_INTRODUCTION_AVANCEMENT,
    "Introduction",
  );
  const erreurCommentaire = erreurLongueur(
    champs.commentaire,
    TAILLE_COMMENTAIRE_AVANCEMENT,
    "Commentaire",
  );
  const modifiee = modifie(depart, champs);
  const corps = corpsModification(depart, champs, rapport.version);
  const raisonValidation = raisonValidationImpossible(rapport, modifiee);
  const occupe = enCours !== null;

  async function executer(
    nom: string,
    appel: () => Promise<unknown>,
    messageSucces: string,
  ): Promise<boolean> {
    if (verrou.current) return false;
    verrou.current = true;
    setEnCours(nom);
    setErreur(null);
    setConflit(false);
    setSucces(null);
    try {
      await appel();
      setSucces(messageSucces);
      router.refresh();
      return true;
    } catch (e) {
      setErreur(messageAvancement(e));
      setConflit(estConflitVersion(e));
      return false;
    } finally {
      verrou.current = false;
      setEnCours(null);
    }
  }

  const chemin = cheminApiRapportAvancement(rapport.id);
  const enregistrer = (forcer: boolean) => {
    const c = corpsModification(depart, champs, rapport.version, forcer);
    if (!c) return Promise.resolve(false);
    return executer(
      forcer ? "relecture" : "enregistrer",
      () => api.patch(chemin, c),
      forcer ? "Commentaire relu et enregistré." : "Modifications enregistrées.",
    );
  };

  async function suggerer() {
    let reponse: ReponseSuggestionAvancement | null = null;
    const ok = await executer(
      "suggerer",
      async () => {
        reponse = await api.post<ReponseSuggestionAvancement>(`${chemin}/suggerer-commentaire`, {
          version: rapport.version,
        });
      },
      "Suggestion enregistrée en brouillon IA : relisez-la avant de valider.",
    );
    // L'IA n'a rien proposé (désactivée, droit, plafond, sortie rejetée…) : ce n'est pas une erreur.
    const r = reponse as ReponseSuggestionAvancement | null;
    if (ok && r && !r.suggestion.obtenue) {
      setSucces(null);
      setErreur(
        r.suggestion.raison
          ? LIBELLES_RAISON_SUGGESTION[r.suggestion.raison]
          : "Aucune suggestion n'a été proposée.",
      );
    }
  }

  return (
    <div className="mp-avc">
      <RetourFormulaire
        erreur={erreur}
        succes={succes}
        refAlerte={refAlerte}
        titreErreur="Action impossible"
      />
      {conflit ? (
        <div className="mp-avc-actions">
          <Bouton
            variante="secondaire"
            onClick={() => {
              setErreur(null);
              setConflit(false);
              router.refresh();
            }}
          >
            Recharger la dernière version
          </Bouton>
          <span className="mp-texte-doux mp-texte-petit">
            Vos saisies non enregistrées seront remplacées.
          </span>
        </div>
      ) : null}

      <form
        className="mp-pile"
        onSubmit={(e) => {
          e.preventDefault();
          if (!erreurIntro && !erreurCommentaire) void enregistrer(false);
        }}
        aria-label="Textes du rapport"
      >
        <Carte titre="Introduction" niveauTitre={3}>
          <div className="mp-pile">
            <ZoneTexte
              libelle="Note d'introduction (facultative)"
              aide="Quelques mots de contexte pour le client. Les chiffres de la semaine sont ajoutés automatiquement."
              rows={4}
              value={champs.introduction}
              onChange={(e) => setChamps({ ...champs, introduction: e.target.value })}
              erreur={erreurIntro}
            />
            <Compteur valeur={champs.introduction} max={TAILLE_INTRODUCTION_AVANCEMENT} />
          </div>
        </Carte>

        <Carte
          titre="Commentaire du chef de mission"
          niveauTitre={3}
          actions={
            etat ? (
              <BadgeStatut tonalite={etat.tonalite} sansIcone={!aIA}>
                {etat.libelle}
              </BadgeStatut>
            ) : null
          }
        >
          <div className="mp-pile">
            {aIA ? (
              <div className="mp-avc-suggestion" role="note">
                <p>
                  <strong>{LIBELLE_BROUILLON_IA}.</strong> {MENTION_BROUILLON_IA}
                </p>
              </div>
            ) : null}
            <ZoneTexte
              libelle="Commentaire"
              aide={
                aIA
                  ? "Texte proposé par l'IA : modifiez-le librement, ou effacez-le si vous n'en voulez pas."
                  : "Votre analyse de la semaine, visible du client une fois le rapport validé."
              }
              rows={8}
              value={champs.commentaire}
              onChange={(e) => setChamps({ ...champs, commentaire: e.target.value })}
              erreur={erreurCommentaire}
            />
            <Compteur valeur={champs.commentaire} max={TAILLE_COMMENTAIRE_AVANCEMENT} />
            {rapport.statut_commentaire !== "redige" ? (
              <div className="mp-avc-actions">
                <Bouton
                  variante="secondaire"
                  disabled={occupe || modifiee || !rapport.peut_valider}
                  chargement={enCours === "suggerer"}
                  texteChargement="Demande à l'IA…"
                  onClick={() => void suggerer()}
                >
                  Suggérer un commentaire (IA)
                </Bouton>
                <span className="mp-texte-doux mp-texte-petit">
                  {modifiee
                    ? "Enregistrez d'abord vos modifications."
                    : "L'IA propose un brouillon à partir des chiffres de la semaine ; vous le relisez avant de valider."}
                </span>
              </div>
            ) : null}
            {aIA ? (
              <div className="mp-avc-actions">
                <Bouton
                  variante="secondaire"
                  disabled={occupe || Boolean(erreurCommentaire) || modifiee}
                  chargement={enCours === "relecture"}
                  texteChargement="Enregistrement…"
                  onClick={() => void enregistrer(true)}
                >
                  J&apos;ai relu ce commentaire
                </Bouton>
                {modifiee ? (
                  <span className="mp-texte-doux mp-texte-petit">
                    Enregistrez d&apos;abord vos modifications : l&apos;enregistrement vaut
                    relecture.
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
        </Carte>

        <div className="mp-avc-actions">
          <Bouton
            type="submit"
            chargement={enCours === "enregistrer"}
            texteChargement="Enregistrement…"
            disabled={occupe || !corps || Boolean(erreurIntro) || Boolean(erreurCommentaire)}
          >
            Enregistrer
          </Bouton>
          {!corps ? (
            <span className="mp-texte-doux mp-texte-petit">Aucune modification à enregistrer.</span>
          ) : null}
        </div>
      </form>

      <Carte titre="Chiffres et validation" niveauTitre={3}>
        <div className="mp-pile">
          <div className="mp-avc-actions">
            <BoutonConfirmation
              libelle="Régénérer les chiffres"
              question="Recalculer les chiffres à la date du jour ? Votre introduction et votre commentaire sont conservés."
              libelleConfirmation="Oui, régénérer"
              texteChargement="Régénération…"
              variante="secondaire"
              action={() =>
                executer(
                  "regenerer",
                  () => api.post(`${chemin}/regenerer`, { version: rapport.version }),
                  "Chiffres régénérés.",
                )
              }
            />
          </div>
          <div className="mp-avc-actions">
            {raisonValidation ? (
              <>
                <Bouton variante="primaire" disabled aria-describedby="avc-raison-validation">
                  Valider le rapport
                </Bouton>
                <span id="avc-raison-validation" className="mp-texte-doux mp-texte-petit">
                  {raisonValidation}
                </span>
              </>
            ) : (
              <BoutonConfirmation
                libelle="Valider le rapport"
                question="Valider ce rapport ? Il deviendra visible du client et ne pourra plus être modifié."
                libelleConfirmation="Oui, valider"
                texteChargement="Validation…"
                variante="primaire"
                action={() =>
                  executer(
                    "valider",
                    () => api.post(`${chemin}/valider`, { version: rapport.version }),
                    "Rapport validé. Il est maintenant visible du client.",
                  )
                }
              />
            )}
          </div>
        </div>
      </Carte>
    </div>
  );
}
