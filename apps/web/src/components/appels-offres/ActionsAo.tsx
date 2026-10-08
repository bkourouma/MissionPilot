"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import {
  CATEGORIE_EXIGENCE_AO_LIBELLES,
  CATEGORIES_EXIGENCE_AO,
  STATUT_CONFORMITE_AO_LIBELLES,
  STATUTS_CONFORMITE_AO,
  type StatutConformiteAo,
} from "@missionpilot/shared";
import { api } from "../../lib/api";
import {
  libelleCategorie,
  libelleStatutAo,
  messageAo,
  SAISIE_EVALUATION_VIDE,
  statutsManuels,
  validerEvaluation,
  validerExigence,
  validerMotif,
  validerTexteDossier,
  type EtapeAo,
  type ExigenceAo,
  type ExtractionAo,
  type SaisieEvaluation,
  type SaisieExigence,
} from "../../lib/appels-offres";
import { optionsPersonnes, type Personne } from "../../lib/personnes";
import type { StatutAppelOffres } from "@missionpilot/shared";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Alerte } from "../ui/Alerte";
import { Bouton, type VarianteBouton } from "../ui/Bouton";
import { CaseACocher } from "../ui/CaseACocher";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";
import { ZoneTexte } from "../ui/ZoneTexte";

/*
 * Actions des écrans d'appels d'offres (AO-01 à AO-03, AO-08). Chaque action appelle l'API, qui
 * reste seule juge des droits, des transitions et des calculs (moteur) ; l'écran se rafraîchit
 * ensuite pour montrer l'état serveur.
 */

const seg = (id: string) => encodeURIComponent(id);

/** Bouton qui exécute une action d'API puis rafraîchit la page ; erreur annoncée en dessous. */
export function BoutonActionAo({
  children,
  action,
  variante = "secondaire",
  confirmation,
}: {
  children: ReactNode;
  action: () => Promise<unknown>;
  variante?: VarianteBouton;
  confirmation?: string;
}) {
  const router = useRouter();
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  return (
    <span className="mp-pile">
      <Bouton
        variante={variante}
        chargement={enCours}
        onClick={async () => {
          if (confirmation && !window.confirm(confirmation)) return;
          setEnCours(true);
          setErreur(null);
          try {
            await action();
            router.refresh();
          } catch (e) {
            setErreur(messageAo(e));
          } finally {
            setEnCours(false);
          }
        }}
      >
        {children}
      </Bouton>
      {erreur ? (
        <Alerte tonalite="danger">
          <p>{erreur}</p>
        </Alerte>
      ) : null}
    </span>
  );
}

/** Dépôt, puis gagné ou perdu (« en réponse » et « no-go » relèvent de la décision). */
export function ActionsStatutAo({ id, statut }: { id: string; statut: StatutAppelOffres }) {
  const statuts = statutsManuels(statut);
  if (statuts.length === 0) return null;
  return (
    <div className="mp-ao__actions">
      {statuts.map((s) => (
        <BoutonActionAo
          key={s}
          variante={s === "perdu" ? "danger" : "primaire"}
          confirmation={`Passer l'appel d'offres à « ${libelleStatutAo(s)} » ?`}
          action={() => api.post(`/api/appels-offres/${seg(id)}/statut`, { statut: s })}
        >
          {s === "depose" ? "Marquer déposé" : `Marquer ${libelleStatutAo(s).toLowerCase()}`}
        </BoutonActionAo>
      ))}
    </div>
  );
}

const CHAMPS_EVALUATION: [keyof SaisieEvaluation, string, string?][] = [
  ["adequation", "Adéquation (0 à 100)", "Vide : score de rapprochement de la fiche."],
  ["references_pertinentes", "Références pertinentes", "Vide : références du secteur trouvées."],
  ["references_exigees", "Références exigées"],
  ["jours_disponibles", "Jours disponibles"],
  ["jours_requis", "Jours requis"],
  ["concurrents_connus", "Concurrents connus"],
  ["concurrents_forts", "dont concurrents forts"],
];

/** Entrées du score go/no-go (AO-02) ; la marge n'est proposée qu'avec `finance.lire`. */
export function FormulaireEvaluationAo({ id, voitFinance }: { id: string; voitFinance: boolean }) {
  const f = useFormulaire<keyof SaisieEvaluation>();
  const [s, setS] = useState<SaisieEvaluation>(SAISIE_EVALUATION_VIDE);
  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        await f.envoyer(
          validerEvaluation(s, voitFinance),
          (c) => api.post(`/api/appels-offres/${seg(id)}/evaluations`, c),
          { messageSpecifique: messageAo, succes: "Score go/no-go calculé." },
        );
      }}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur="Évaluation impossible"
      />
      <div className="mp-grille-champs">
        {CHAMPS_EVALUATION.map(([cle, libelle, aide]) => (
          <Champ
            key={cle}
            libelle={libelle}
            inputMode="numeric"
            value={s[cle]}
            onChange={(e) => setS((x) => ({ ...x, [cle]: e.target.value }))}
            erreur={f.erreurs[cle]}
            aide={aide}
          />
        ))}
        {voitFinance ? (
          <>
            <Champ
              libelle="Marge estimée (%)"
              inputMode="decimal"
              value={s.marge}
              onChange={(e) => setS((x) => ({ ...x, marge: e.target.value }))}
              erreur={f.erreurs.marge}
              aide="Donnée financière (FIN-02) ; vide : critère non évalué."
            />
            <Champ
              libelle="Marge cible (%)"
              inputMode="decimal"
              value={s.marge_cible}
              onChange={(e) => setS((x) => ({ ...x, marge_cible: e.target.value }))}
              erreur={f.erreurs.marge_cible}
            />
          </>
        ) : null}
      </div>
      <Bouton type="submit" chargement={f.enCours} texteChargement="Calcul…">
        Calculer le score
      </Bouton>
    </form>
  );
}

/** Décision go/no-go de l'associé, motivée, sur la dernière évaluation (AO-02). */
export function FormulaireDecisionAo({
  id,
  evaluationId,
  goPossible,
}: {
  id: string;
  evaluationId: string;
  goPossible: boolean;
}) {
  const f = useFormulaire<"motif">();
  const [motif, setMotif] = useState("");
  const decider = (decision: "go" | "no_go") =>
    f.envoyer(
      validerMotif(motif),
      (m) =>
        api.post(`/api/appels-offres/${seg(id)}/decision`, {
          evaluation_id: evaluationId,
          decision,
          motif: m,
        }),
      { messageSpecifique: messageAo, succes: "Décision enregistrée." },
    );
  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={(e) => e.preventDefault()}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur="Décision impossible"
      />
      <ZoneTexte
        libelle="Motif de la décision"
        required
        maxLength={2000}
        value={motif}
        onChange={(e) => setMotif(e.target.value)}
        erreur={f.erreurs.motif}
      />
      <div className="mp-ao__actions">
        {goPossible ? (
          <Bouton chargement={f.enCours} onClick={() => decider("go")}>
            Décider go
          </Bouton>
        ) : null}
        <Bouton variante="danger" chargement={f.enCours} onClick={() => decider("no_go")}>
          Décider no-go
        </Bouton>
      </div>
    </form>
  );
}

/** Dépôt du texte du dossier d'appel d'offres (contenu non fiable, jamais suivi). */
export function FormulaireDossierAo({ id }: { id: string }) {
  const f = useFormulaire<"texte">();
  const [texte, setTexte] = useState("");
  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        const ok = await f.envoyer(
          validerTexteDossier(texte),
          (t) => api.post(`/api/appels-offres/${seg(id)}/dossiers`, { texte: t }),
          { messageSpecifique: messageAo, succes: "Dossier enregistré." },
        );
        if (ok) setTexte("");
      }}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur="Dossier refusé"
      />
      <ZoneTexte
        libelle="Texte du dossier (règlement, termes de référence)"
        rows={8}
        value={texte}
        onChange={(e) => setTexte(e.target.value)}
        erreur={f.erreurs.texte}
        aide="Collez le texte (200 000 caractères au plus). Il est traité comme une donnée : aucune consigne qu'il contient n'est suivie."
      />
      <Bouton type="submit" chargement={f.enCours}>
        Enregistrer le dossier
      </Bouton>
    </form>
  );
}

/** Extraction des exigences d'un dossier : IA (brouillon) ou découpage déterministe. */
export function LancerExtractionAo({
  id,
  dossierId,
  ia,
}: {
  id: string;
  dossierId: string;
  ia: boolean;
}) {
  return (
    <div className="mp-ao__actions">
      {ia ? (
        <BoutonActionAo
          variante="primaire"
          action={() =>
            api.post(`/api/appels-offres/${seg(id)}/extractions`, {
              dossier_id: dossierId,
              mode: "ia",
            })
          }
        >
          Extraire avec l&apos;IA
        </BoutonActionAo>
      ) : null}
      <BoutonActionAo
        action={() =>
          api.post(`/api/appels-offres/${seg(id)}/extractions`, {
            dossier_id: dossierId,
            mode: "deterministe",
          })
        }
      >
        Découpage automatique
      </BoutonActionAo>
    </div>
  );
}

/** Validation humaine d'un brouillon d'extraction : les propositions cochées entrent dans la matrice. */
export function ValidationExtractionAo({ extraction }: { extraction: ExtractionAo }) {
  const [retenues, setRetenues] = useState<number[]>(extraction.propositions.map((_, i) => i));
  const [acquitte, setAcquitte] = useState(false);
  const url = `/api/appels-offres/extractions/${seg(extraction.id)}/decision`;
  return (
    <div className="mp-pile">
      <ul className="mp-liste-lignes">
        {extraction.propositions.map((p, i) => (
          <li key={i} className="mp-liste-lignes__ligne">
            <CaseACocher
              libelle={`${p.reference ? `[${p.reference}] ` : ""}${p.libelle}`}
              aide={`${libelleCategorie(p.categorie)} · ${p.obligatoire ? "obligatoire" : "facultative"}`}
              checked={retenues.includes(i)}
              onChange={(e) =>
                setRetenues((r) =>
                  e.target.checked ? [...r, i].sort((a, b) => a - b) : r.filter((x) => x !== i),
                )
              }
            />
          </li>
        ))}
      </ul>
      {extraction.chiffres_non_verifies ? (
        <CaseACocher
          libelle="J'ai relu les nombres cités par le brouillon et je les assume"
          aide="Le brouillon IA contient des nombres que le contrôle n'a pas pu vérifier."
          checked={acquitte}
          onChange={(e) => setAcquitte(e.target.checked)}
        />
      ) : null}
      <div className="mp-ao__actions">
        <BoutonActionAo
          variante="primaire"
          action={() =>
            api.post(url, {
              decision: "validee",
              retenues,
              ...(extraction.chiffres_non_verifies ? { acquitte_chiffres: acquitte } : {}),
            })
          }
        >
          Valider {retenues.length} exigence(s)
        </BoutonActionAo>
        <BoutonActionAo variante="danger" action={() => api.post(url, { decision: "rejetee" })}>
          Rejeter le brouillon
        </BoutonActionAo>
      </div>
    </div>
  );
}

/** Ajout manuel d'une exigence à la matrice. */
export function FormulaireExigenceAo({ id }: { id: string }) {
  const f = useFormulaire<keyof SaisieExigence>();
  const vide: SaisieExigence = {
    libelle: "",
    categorie: "administrative",
    obligatoire: true,
    reference: "",
  };
  const [s, setS] = useState<SaisieExigence>(vide);
  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        const ok = await f.envoyer(
          validerExigence(s),
          (c) => api.post(`/api/appels-offres/${seg(id)}/exigences`, c),
          { messageSpecifique: messageAo },
        );
        if (ok) setS(vide);
      }}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        refAlerte={f.refAlerte}
        titreErreur="Ajout impossible"
      />
      <ZoneTexte
        libelle="Exigence"
        required
        maxLength={1000}
        value={s.libelle}
        onChange={(e) => setS((x) => ({ ...x, libelle: e.target.value }))}
        erreur={f.erreurs.libelle}
      />
      <div className="mp-grille-champs">
        <Select
          libelle="Catégorie"
          value={s.categorie}
          onChange={(e) => setS((x) => ({ ...x, categorie: e.target.value }))}
          options={CATEGORIES_EXIGENCE_AO.map((c) => ({
            valeur: c,
            libelle: CATEGORIE_EXIGENCE_AO_LIBELLES[c],
          }))}
          erreur={f.erreurs.categorie}
        />
        <Champ
          libelle="Référence (clause)"
          maxLength={60}
          value={s.reference}
          onChange={(e) => setS((x) => ({ ...x, reference: e.target.value }))}
          erreur={f.erreurs.reference}
        />
      </div>
      <CaseACocher
        libelle="Exigence obligatoire"
        checked={s.obligatoire}
        onChange={(e) => setS((x) => ({ ...x, obligatoire: e.target.checked }))}
      />
      <Bouton type="submit" variante="secondaire" chargement={f.enCours}>
        Ajouter l&apos;exigence
      </Bouton>
    </form>
  );
}

/** Suivi d'une ligne de la matrice : statut, commentaire, pièce justificative. */
export function SuiviExigenceAo({ exigence }: { exigence: ExigenceAo }) {
  const router = useRouter();
  const [statut, setStatut] = useState<StatutConformiteAo>(exigence.statut);
  const [commentaire, setCommentaire] = useState(exigence.commentaire ?? "");
  const [piece, setPiece] = useState(exigence.piece ?? "");
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  return (
    <div className="mp-pile">
      <div className="mp-grille-champs">
        <Select
          libelle="Statut"
          value={statut}
          onChange={(e) => setStatut(e.target.value as StatutConformiteAo)}
          options={STATUTS_CONFORMITE_AO.map((x) => ({
            valeur: x,
            libelle: STATUT_CONFORMITE_AO_LIBELLES[x],
          }))}
        />
        <Champ
          libelle="Pièce"
          maxLength={300}
          value={piece}
          onChange={(e) => setPiece(e.target.value)}
        />
      </div>
      <Champ
        libelle="Commentaire"
        maxLength={2000}
        value={commentaire}
        onChange={(e) => setCommentaire(e.target.value)}
        aide={
          exigence.obligatoire && statut === "sans_objet"
            ? "Obligatoire : motivez l'écart."
            : undefined
        }
      />
      {erreur ? (
        <Alerte tonalite="danger">
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      <Bouton
        variante="secondaire"
        chargement={enCours}
        onClick={async () => {
          setEnCours(true);
          setErreur(null);
          try {
            await api.patch(`/api/appels-offres/exigences/${seg(exigence.id)}`, {
              statut,
              commentaire: commentaire.trim() === "" ? null : commentaire,
              piece: piece.trim() === "" ? null : piece,
            });
            router.refresh();
          } catch (e) {
            setErreur(messageAo(e));
          } finally {
            setEnCours(false);
          }
        }}
      >
        Enregistrer
      </Bouton>
    </div>
  );
}

/** Étape du rétro-planning : fait / à refaire, et confier par une tâche assignée. */
export function ActionsEtapeAo({
  etape,
  personnes,
  peutAssigner,
}: {
  etape: EtapeAo;
  personnes: readonly Personne[];
  peutAssigner: boolean;
}) {
  const [assignee, setAssignee] = useState(personnes[0]?.utilisateur_id ?? "");
  const url = `/api/appels-offres/retroplanning/${seg(etape.id)}`;
  return (
    <div className="mp-ao__actions">
      <BoutonActionAo action={() => api.patch(url, { faite: !etape.faite })}>
        {etape.faite ? "Rouvrir" : "Marquer faite"}
      </BoutonActionAo>
      {peutAssigner && !etape.tache_id && personnes.length > 0 ? (
        <>
          <Select
            libelle="Confier à"
            value={assignee}
            onChange={(e) => setAssignee(e.target.value)}
            options={optionsPersonnes(personnes)}
          />
          <BoutonActionAo action={() => api.post(`${url}/tache`, { assignee_id: assignee })}>
            Créer la tâche
          </BoutonActionAo>
        </>
      ) : null}
    </div>
  );
}
