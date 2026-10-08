"use client";

import { useState, type FormEvent } from "react";
import { SECTIONS_RETOUR, type RetourVersion, type SectionRetour } from "@missionpilot/shared";
import { api } from "../../lib/api";
import {
  libelleNiveauCompetence,
  libelleNiveauEstimation,
  libelleSection,
  lireCompetence,
  lireEstimation,
  lireNiveau,
  lireVersionRetour,
  messageCapitalisation,
  type ReponseEstimation,
} from "../../lib/capitalisation";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { BadgeStatut } from "../ui/BadgeStatut";
import { Bouton } from "../ui/Bouton";
import { CaseACocher } from "../ui/CaseACocher";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";
import { Tableau } from "../ui/Tableau";
import { ZoneTexte } from "../ui/ZoneTexte";

/*
 * Formulaires de la rubrique « Connaissances » : rédaction, génération IA et validation d'un
 * retour d'expérience ; estimation par brique ; déclaration et validation d'un niveau de
 * compétence ; référentiel des compétences ; rattachement d'une tâche à une brique ; proposition
 * d'évolution du standard. L'API reste juge de chaque droit.
 */

const OPTS = { messageSpecifique: messageCapitalisation };

export function FormulaireVersionRetour({ id, initiale }: { id: string; initiale: RetourVersion }) {
  const f = useFormulaire<SectionRetour>();
  const [s, setS] = useState<Record<SectionRetour, string>>({ ...initiale });

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await f.envoyer(
      lireVersionRetour(s),
      (c) => api.post(`/api/capitalisation/retours/${id}/versions`, c),
      { ...OPTS, succes: "Nouvelle version enregistrée." },
    );
  }

  return (
    <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={soumettre}>
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      {SECTIONS_RETOUR.map((k) => (
        <ZoneTexte
          key={k}
          libelle={libelleSection(k)}
          required
          rows={6}
          maxLength={8000}
          value={s[k]}
          onChange={(e) => setS({ ...s, [k]: e.target.value })}
          erreur={f.erreurs[k]}
        />
      ))}
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement="Enregistrement…">
          Enregistrer une nouvelle version
        </Bouton>
      </div>
    </form>
  );
}

export function ActionsRetour({
  id,
  version,
  chiffresNonVerifies,
  ia,
}: {
  id: string;
  version: number;
  chiffresNonVerifies: boolean;
  ia: boolean;
}) {
  const fIa = useFormulaire<never>();
  const fVal = useFormulaire<never>();
  const [acquitte, setAcquitte] = useState(false);

  return (
    <div className="mp-connaissances__actions">
      {ia ? (
        <div>
          <RetourFormulaire
            erreur={fIa.erreurGlobale}
            succes={fIa.succes}
            refAlerte={fIa.refAlerte}
          />
          <Bouton
            variante="secondaire"
            icone="nuage"
            chargement={fIa.enCours}
            texteChargement="Rédaction en cours…"
            onClick={() =>
              fIa.envoyer(
                { ok: true, charge: null },
                () => api.post(`/api/capitalisation/retours/${id}/ia`),
                {
                  ...OPTS,
                  succes: "Brouillon proposé : relisez-le avant de valider.",
                },
              )
            }
          >
            Proposer une rédaction par l&apos;IA
          </Bouton>
        </div>
      ) : null}
      <div>
        <RetourFormulaire
          erreur={fVal.erreurGlobale}
          succes={fVal.succes}
          refAlerte={fVal.refAlerte}
        />
        {chiffresNonVerifies ? (
          <CaseACocher
            libelle="J'ai vérifié les nombres signalés : ils sont exacts."
            checked={acquitte}
            onChange={(e) => setAcquitte(e.target.checked)}
          />
        ) : null}
        <Bouton
          icone="succes"
          chargement={fVal.enCours}
          texteChargement="Validation…"
          onClick={() =>
            fVal.envoyer(
              { ok: true, charge: { version, acquitte_chiffres: acquitte } },
              (c) => api.post(`/api/capitalisation/retours/${id}/valider`, c),
              {
                ...OPTS,
                succes: "Retour d'expérience validé et versé à la base de connaissances.",
              },
            )
          }
        >
          {`Valider la version ${version}`}
        </Bouton>
      </div>
    </div>
  );
}

export function FormulaireEstimation() {
  const f = useFormulaire<"briques" | "effectif">();
  const [briques, setBriques] = useState("");
  const [effectif, setEffectif] = useState("");
  const [resultat, setResultat] = useState<ReponseEstimation | null>(null);

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await f.envoyer(
      lireEstimation({ briques, effectif }),
      (c) => api.post<ReponseEstimation>("/api/capitalisation/estimation", c),
      { ...OPTS, rafraichir: false, apres: (r) => setResultat(r) },
    );
  }

  return (
    <>
      <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={soumettre}>
        <RetourFormulaire erreur={f.erreurGlobale} refAlerte={f.refAlerte} />
        <div className="mp-grille-champs">
          <Champ
            libelle="Briques (codes séparés par des virgules)"
            required
            value={briques}
            onChange={(e) => setBriques(e.target.value)}
            erreur={f.erreurs.briques}
          />
          <Champ
            libelle="Effectif minimum (3 à 20, 3 par défaut)"
            inputMode="numeric"
            value={effectif}
            onChange={(e) => setEffectif(e.target.value)}
            erreur={f.erreurs.effectif}
          />
        </div>
        <div className="mp-actions-formulaire">
          <Bouton type="submit" icone="recherche" chargement={f.enCours} texteChargement="Calcul…">
            Estimer
          </Bouton>
        </div>
      </form>
      {resultat ? (
        <Tableau
          legende="Temps réels observés par brique"
          legendeVisible
          cleLigne={(l) => l.brique_code}
          lignes={resultat.elements}
          colonnes={[
            { cle: "brique_code", entete: "Brique" },
            { cle: "niveau", entete: "Base", rendu: (l) => libelleNiveauEstimation(l.niveau) },
            {
              cle: "effectif",
              entete: "Missions",
              alignement: "droite",
              rendu: (l) => l.effectif_brique ?? "—",
            },
            {
              cle: "q1",
              entete: "1er quartile",
              alignement: "droite",
              rendu: (l) => l.libelles?.q1 ?? "—",
            },
            {
              cle: "mediane",
              entete: "Médiane",
              alignement: "droite",
              rendu: (l) => l.libelles?.mediane ?? "—",
            },
            {
              cle: "q3",
              entete: "3e quartile",
              alignement: "droite",
              rendu: (l) => l.libelles?.q3 ?? "—",
            },
          ]}
        />
      ) : null}
    </>
  );
}

const OPTIONS_NIVEAUX = [1, 2, 3, 4].map((n) => ({
  valeur: String(n),
  libelle: libelleNiveauCompetence(n),
}));

export function FormulaireDeclaration({
  competences,
  collaborateurId,
}: {
  competences: { id: string; libelle: string }[];
  /** Absent : déclaration pour soi. */
  collaborateurId?: string;
}) {
  const f = useFormulaire<"niveau">();
  const [competence, setCompetence] = useState(competences[0]?.id ?? "");
  const [niveau, setNiveau] = useState("");

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const n = lireNiveau(niveau);
    await f.envoyer(
      n,
      (c) =>
        api.post("/api/capitalisation/competences/declarations", {
          competence_id: competence,
          niveau: c.niveau,
          ...(collaborateurId ? { collaborateur_id: collaborateurId } : {}),
        }),
      { ...OPTS, succes: "Niveau déclaré : il attend une validation." },
    );
  }

  return (
    <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={soumettre}>
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      <div className="mp-grille-champs">
        <Select
          libelle="Compétence"
          value={competence}
          onChange={(e) => setCompetence(e.target.value)}
          options={competences.map((c) => ({ valeur: c.id, libelle: c.libelle }))}
        />
        <Select
          libelle="Niveau"
          value={niveau}
          onChange={(e) => setNiveau(e.target.value)}
          options={[{ valeur: "", libelle: "Choisir…" }, ...OPTIONS_NIVEAUX]}
          erreur={f.erreurs.niveau}
        />
      </div>
      <div className="mp-actions-formulaire">
        <Bouton type="submit" variante="secondaire" chargement={f.enCours} texteChargement="Envoi…">
          Déclarer
        </Bouton>
      </div>
    </form>
  );
}

export function DecisionDeclaration({
  declarationId,
  niveau,
}: {
  declarationId: string;
  niveau: number;
}) {
  const f = useFormulaire<"commentaire">();
  const [commentaire, setCommentaire] = useState("");
  const decider = (decision: "validee" | "refusee") =>
    f.envoyer(
      decision === "refusee" && commentaire.trim() === ""
        ? { ok: false, erreurs: { commentaire: "Un refus est motivé." } }
        : {
            ok: true,
            charge: {
              decision,
              ...(commentaire.trim() ? { commentaire: commentaire.trim() } : {}),
            },
          },
      (c) => api.post(`/api/capitalisation/competences/declarations/${declarationId}/decision`, c),
      { ...OPTS, succes: decision === "validee" ? "Niveau validé." : "Déclaration refusée." },
    );
  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={(e) => e.preventDefault()}
    >
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      <p className="mp-texte-petit">{`Niveau déclaré : ${libelleNiveauCompetence(niveau)}`}</p>
      <Champ
        libelle="Commentaire (obligatoire pour refuser)"
        maxLength={1000}
        value={commentaire}
        onChange={(e) => setCommentaire(e.target.value)}
        erreur={f.erreurs.commentaire}
      />
      <div className="mp-actions-formulaire">
        <Bouton type="button" chargement={f.enCours} onClick={() => decider("validee")}>
          Valider
        </Bouton>
        <Bouton
          type="button"
          variante="discret"
          chargement={f.enCours}
          onClick={() => decider("refusee")}
        >
          Refuser
        </Bouton>
      </div>
    </form>
  );
}

export function FormulaireCompetence() {
  const f = useFormulaire<"code" | "libelle" | "briques">();
  const [s, setS] = useState({ code: "", libelle: "", briques: "" });
  const [types, setTypes] = useState<string[]>([]);
  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const ok = await f.envoyer(
      lireCompetence(s),
      (c) => api.post("/api/capitalisation/competences", { ...c, types_livrable: types }),
      { ...OPTS, succes: "Compétence ajoutée au référentiel." },
    );
    if (ok) setS({ code: "", libelle: "", briques: "" });
  }
  const TYPES = [
    ["rapport", "Rapport"],
    ["notation", "Notation"],
    ["plan", "Plan stratégique"],
    ["questionnaire", "Questionnaire"],
  ] as const;
  return (
    <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={soumettre}>
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      <div className="mp-grille-champs">
        <Champ
          libelle="Code"
          required
          value={s.code}
          onChange={(e) => setS({ ...s, code: e.target.value })}
          erreur={f.erreurs.code}
        />
        <Champ
          libelle="Libellé"
          required
          value={s.libelle}
          onChange={(e) => setS({ ...s, libelle: e.target.value })}
          erreur={f.erreurs.libelle}
        />
      </div>
      <Champ
        libelle="Briques qui en apportent la preuve (codes)"
        aide="Le temps validé sur une tâche rattachée à ces briques devient une preuve d'usage."
        value={s.briques}
        onChange={(e) => setS({ ...s, briques: e.target.value })}
        erreur={f.erreurs.briques}
      />
      <fieldset className="mp-connaissances__types">
        <legend>Livrables rédigés ou relus qui en apportent la preuve</legend>
        {TYPES.map(([v, l]) => (
          <CaseACocher
            key={v}
            libelle={l}
            checked={types.includes(v)}
            onChange={(e) =>
              setTypes(e.target.checked ? [...types, v] : types.filter((x) => x !== v))
            }
          />
        ))}
      </fieldset>
      <div className="mp-actions-formulaire">
        <Bouton type="submit" variante="secondaire" icone="plus" chargement={f.enCours}>
          Ajouter la compétence
        </Bouton>
      </div>
    </form>
  );
}

export function SelectBriqueTache({
  missionId,
  tacheId,
  libelleTache,
  valeur,
  briques,
}: {
  missionId: string;
  tacheId: string;
  libelleTache: string;
  valeur: string | null;
  briques: { code: string; libelle: string; etape: string }[];
}) {
  const f = useFormulaire<never>();
  const [code, setCode] = useState(valeur ?? "");
  return (
    <div>
      <RetourFormulaire erreur={f.erreurGlobale} refAlerte={f.refAlerte} />
      <Select
        libelle={libelleTache}
        value={code}
        disabled={f.enCours}
        onChange={(e) => {
          const v = e.target.value;
          setCode(v);
          void f.envoyer(
            { ok: true, charge: { brique_code: v === "" ? null : v } },
            (c) => api.put(`/api/capitalisation/missions/${missionId}/taches/${tacheId}/brique`, c),
            OPTS,
          );
        }}
        options={[
          { valeur: "", libelle: "Aucune brique" },
          ...briques.map((b) => ({ valeur: b.code, libelle: `${b.etape} · ${b.libelle}` })),
        ]}
      />
    </div>
  );
}

export function BoutonProposition({ cle, seuil }: { cle: string; seuil: number }) {
  const f = useFormulaire<never>();
  return (
    <div>
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      <Bouton
        variante="secondaire"
        icone="envoyer"
        chargement={f.enCours}
        onClick={() =>
          f.envoyer(
            { ok: true, charge: { cle, seuil } },
            (c) => api.post("/api/capitalisation/derogations/propositions", c),
            { ...OPTS, succes: "Proposition soumise au comité méthode." },
          )
        }
      >
        Proposer au comité méthode
      </Bouton>
    </div>
  );
}

export function BadgeAttente({ libelle }: { libelle: string }) {
  return <BadgeStatut tonalite="attention">{libelle}</BadgeStatut>;
}
