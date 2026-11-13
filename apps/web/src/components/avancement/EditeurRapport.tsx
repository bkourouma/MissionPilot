"use client";

import { useRafraichir } from "../formulaires/useRafraichir";
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
  libellesAvancement,
  LIBELLES_RAISON_SUGGESTION,
  LIBELLES_RAISON_SUGGESTION_EN,
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
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { BoutonConfirmation } from "../formulaires/BoutonConfirmation";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { Alerte } from "../ui/Alerte";
import { BadgeStatut } from "../ui/BadgeStatut";
import { Bouton } from "../ui/Bouton";
import { Carte } from "../ui/Carte";
import { ZoneTexte } from "../ui/ZoneTexte";
import "./avancement.css";

function Compteur({ valeur, max }: { valeur: string; max: number }) {
  const t = useT();
  const langue = useLangue();
  const n = valeur.trim().length;
  return (
    <p className={n > max ? "mp-avc-compteur mp-avc-compteur--depasse" : "mp-avc-compteur"}>
      {`${formaterNombre(n, 0, langue)} / ${formaterNombre(max, 0, langue)} ${t("caractères", "characters")}`}
    </p>
  );
}

/** Lecture seule d'un texte du chef de mission (rapport validé). */
function TexteFige({ titre, texte }: { titre: string; texte: string | null }) {
  const t = useT();
  return (
    <Carte titre={titre} niveauTitre={3}>
      {texte ? (
        <p className="mp-avc-texte">{texte}</p>
      ) : (
        <p className="mp-texte-doux">{t("Non renseigné.", "Not provided.")}</p>
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
  const t = useT();
  const langue = useLangue();
  const libelles = libellesAvancement(langue);
  const { rafraichir } = useRafraichir();
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
  const etat = etatCommentaire(rapport.statut_commentaire, langue);

  if (fige) {
    return (
      <div className="mp-avc">
        <Alerte
          tonalite="succes"
          annonce="aucune"
          titre={`${t("Rapport validé le", "Report approved on")} ${formaterDateHeure(rapport.valide_le, undefined, langue)}`}
        >
          <p>
            {rapport.valide_par?.nom
              ? `${t("Validé par", "Approved by")} ${rapport.valide_par.nom}. `
              : ""}
            {t(
              "Ce rapport est figé : il est visible du client et ne peut plus être modifié.",
              "This report is locked: it is visible to the client and can no longer be edited.",
            )}
          </p>
        </Alerte>
        <TexteFige titre={t("Introduction", "Introduction")} texte={rapport.introduction} />
        <TexteFige
          titre={t("Commentaire du chef de mission", "Engagement manager's comment")}
          texte={rapport.commentaire}
        />
      </div>
    );
  }

  const erreurIntro = erreurLongueur(
    champs.introduction,
    TAILLE_INTRODUCTION_AVANCEMENT,
    t("Introduction", "Introduction"),
    langue,
  );
  const erreurCommentaire = erreurLongueur(
    champs.commentaire,
    TAILLE_COMMENTAIRE_AVANCEMENT,
    t("Commentaire", "Comment"),
    langue,
  );
  const modifiee = modifie(depart, champs);
  const corps = corpsModification(depart, champs, rapport.version);
  const raisonValidation = raisonValidationImpossible(rapport, modifiee, langue);
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
      rafraichir();
      return true;
    } catch (e) {
      setErreur(messageAvancement(e, langue));
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
      forcer
        ? t("Commentaire relu et enregistré.", "Comment reviewed and saved.")
        : t("Modifications enregistrées.", "Changes saved."),
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
      t(
        "Suggestion enregistrée en brouillon IA : relisez-la avant de valider.",
        "Suggestion saved as an AI draft: review it before approving.",
      ),
    );
    // L'IA n'a rien proposé (désactivée, droit, plafond, sortie rejetée…) : ce n'est pas une erreur.
    const r = reponse as ReponseSuggestionAvancement | null;
    if (ok && r && !r.suggestion.obtenue) {
      setSucces(null);
      setErreur(
        r.suggestion.raison
          ? (langue === "en" ? LIBELLES_RAISON_SUGGESTION_EN : LIBELLES_RAISON_SUGGESTION)[
              r.suggestion.raison
            ]
          : t("Aucune suggestion n'a été proposée.", "No suggestion was proposed."),
      );
    }
  }

  return (
    <div className="mp-avc">
      <RetourFormulaire
        erreur={erreur}
        succes={succes}
        refAlerte={refAlerte}
        titreErreur={t("Action impossible", "Action not possible")}
      />
      {conflit ? (
        <div className="mp-avc-actions">
          <Bouton
            variante="secondaire"
            onClick={() => {
              setErreur(null);
              setConflit(false);
              rafraichir();
            }}
          >
            {t("Recharger la dernière version", "Reload the latest version")}
          </Bouton>
          <span className="mp-texte-doux mp-texte-petit">
            {t(
              "Vos saisies non enregistrées seront remplacées.",
              "Your unsaved entries will be replaced.",
            )}
          </span>
        </div>
      ) : null}

      <form
        className="mp-pile"
        onSubmit={(e) => {
          e.preventDefault();
          if (!erreurIntro && !erreurCommentaire) void enregistrer(false);
        }}
        aria-label={t("Textes du rapport", "Report texts")}
      >
        <Carte titre={t("Introduction", "Introduction")} niveauTitre={3}>
          <div className="mp-pile">
            <ZoneTexte
              libelle={t("Note d'introduction (facultative)", "Introductory note (optional)")}
              aide={t(
                "Quelques mots de contexte pour le client. Les chiffres de la semaine sont ajoutés automatiquement.",
                "A few words of context for the client. This week's figures are added automatically.",
              )}
              rows={4}
              value={champs.introduction}
              onChange={(e) => setChamps({ ...champs, introduction: e.target.value })}
              erreur={erreurIntro}
            />
            <Compteur valeur={champs.introduction} max={TAILLE_INTRODUCTION_AVANCEMENT} />
          </div>
        </Carte>

        <Carte
          titre={t("Commentaire du chef de mission", "Engagement manager's comment")}
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
                  <strong>{libelles.libelleBrouillonIa}.</strong> {libelles.mentionBrouillonIa}
                </p>
              </div>
            ) : null}
            <ZoneTexte
              libelle={t("Commentaire", "Comment")}
              aide={
                aIA
                  ? t(
                      "Texte proposé par l'IA : modifiez-le librement, ou effacez-le si vous n'en voulez pas.",
                      "Text proposed by the AI: edit it freely, or clear it if you do not want it.",
                    )
                  : t(
                      "Votre analyse de la semaine, visible du client une fois le rapport validé.",
                      "Your analysis of the week, visible to the client once the report is approved.",
                    )
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
                  texteChargement={t("Demande à l'IA…", "Asking the AI…")}
                  onClick={() => void suggerer()}
                >
                  {t("Suggérer un commentaire (IA)", "Suggest a comment (AI)")}
                </Bouton>
                <span className="mp-texte-doux mp-texte-petit">
                  {modifiee
                    ? t("Enregistrez d'abord vos modifications.", "Save your changes first.")
                    : t(
                        "L'IA propose un brouillon à partir des chiffres de la semaine ; vous le relisez avant de valider.",
                        "The AI proposes a draft based on this week's figures; you review it before approving.",
                      )}
                </span>
              </div>
            ) : null}
            {aIA ? (
              <div className="mp-avc-actions">
                <Bouton
                  variante="secondaire"
                  disabled={occupe || Boolean(erreurCommentaire) || modifiee}
                  chargement={enCours === "relecture"}
                  texteChargement={t("Enregistrement…", "Saving…")}
                  onClick={() => void enregistrer(true)}
                >
                  {t("J'ai relu ce commentaire", "I have reviewed this comment")}
                </Bouton>
                {modifiee ? (
                  <span className="mp-texte-doux mp-texte-petit">
                    {t(
                      "Enregistrez d'abord vos modifications : l'enregistrement vaut relecture.",
                      "Save your changes first: saving counts as a review.",
                    )}
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
            texteChargement={t("Enregistrement…", "Saving…")}
            disabled={occupe || !corps || Boolean(erreurIntro) || Boolean(erreurCommentaire)}
          >
            {t("Enregistrer", "Save")}
          </Bouton>
          {!corps ? (
            <span className="mp-texte-doux mp-texte-petit">
              {t("Aucune modification à enregistrer.", "No changes to save.")}
            </span>
          ) : null}
        </div>
      </form>

      <Carte titre={t("Chiffres et validation", "Figures and approval")} niveauTitre={3}>
        <div className="mp-pile">
          <div className="mp-avc-actions">
            <BoutonConfirmation
              libelle={t("Régénérer les chiffres", "Regenerate figures")}
              question={t(
                "Recalculer les chiffres à la date du jour ? Votre introduction et votre commentaire sont conservés.",
                "Recompute the figures as of today? Your introduction and comment are kept.",
              )}
              libelleConfirmation={t("Oui, régénérer", "Yes, regenerate")}
              texteChargement={t("Régénération…", "Regenerating…")}
              variante="secondaire"
              action={() =>
                executer(
                  "regenerer",
                  () => api.post(`${chemin}/regenerer`, { version: rapport.version }),
                  t("Chiffres régénérés.", "Figures regenerated."),
                )
              }
            />
          </div>
          <div className="mp-avc-actions">
            {raisonValidation ? (
              <>
                <Bouton variante="primaire" disabled aria-describedby="avc-raison-validation">
                  {t("Valider le rapport", "Approve the report")}
                </Bouton>
                <span id="avc-raison-validation" className="mp-texte-doux mp-texte-petit">
                  {raisonValidation}
                </span>
              </>
            ) : (
              <BoutonConfirmation
                libelle={t("Valider le rapport", "Approve the report")}
                question={t(
                  "Valider ce rapport ? Il deviendra visible du client et ne pourra plus être modifié.",
                  "Approve this report? It will become visible to the client and can no longer be edited.",
                )}
                libelleConfirmation={t("Oui, valider", "Yes, approve")}
                texteChargement={t("Validation…", "Approving…")}
                variante="primaire"
                action={() =>
                  executer(
                    "valider",
                    () => api.post(`${chemin}/valider`, { version: rapport.version }),
                    t(
                      "Rapport validé. Il est maintenant visible du client.",
                      "Report approved. It is now visible to the client.",
                    ),
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
