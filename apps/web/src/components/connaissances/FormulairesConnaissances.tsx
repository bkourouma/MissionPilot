"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import {
  SECTIONS_RETOUR,
  type Langue,
  type RetourVersion,
  type SectionRetour,
} from "@missionpilot/shared";
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
  hrefRetour,
  type ReponseEstimation,
} from "../../lib/capitalisation";
import { useLangue, useT } from "../i18n/FournisseurLangue";
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

const optsLangue = (langue: Langue) => ({
  messageSpecifique: (e: unknown) => messageCapitalisation(e, langue),
});

export function FormulaireVersionRetour({ id, initiale }: { id: string; initiale: RetourVersion }) {
  const t = useT();
  const langue = useLangue();
  const OPTS = optsLangue(langue);
  const f = useFormulaire<SectionRetour>();
  const [s, setS] = useState<Record<SectionRetour, string>>({ ...initiale });

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await f.envoyer(
      lireVersionRetour(s, langue),
      (c) => api.post(`/api/capitalisation/retours/${id}/versions`, c),
      { ...OPTS, succes: t("Nouvelle version enregistrée.", "New version saved.") },
    );
  }

  return (
    <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={soumettre}>
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      {SECTIONS_RETOUR.map((k) => (
        <ZoneTexte
          key={k}
          libelle={libelleSection(k, langue)}
          required
          rows={6}
          maxLength={8000}
          value={s[k]}
          onChange={(e) => setS({ ...s, [k]: e.target.value })}
          erreur={f.erreurs[k]}
        />
      ))}
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          chargement={f.enCours}
          texteChargement={t("Enregistrement…", "Saving…")}
        >
          {t("Enregistrer une nouvelle version", "Save a new version")}
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
  const t = useT();
  const OPTS = optsLangue(useLangue());
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
            texteChargement={t("Rédaction en cours…", "Drafting…")}
            onClick={() =>
              fIa.envoyer(
                { ok: true, charge: null },
                () => api.post(`/api/capitalisation/retours/${id}/ia`),
                {
                  ...OPTS,
                  succes: t(
                    "Brouillon proposé : relisez-le avant de valider.",
                    "Draft proposed: review it before approving.",
                  ),
                },
              )
            }
          >
            {t("Proposer une rédaction par l'IA", "Suggest an AI draft")}
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
            libelle={t(
              "J'ai vérifié les nombres signalés : ils sont exacts.",
              "I have checked the flagged numbers: they are accurate.",
            )}
            checked={acquitte}
            onChange={(e) => setAcquitte(e.target.checked)}
          />
        ) : null}
        <Bouton
          icone="succes"
          chargement={fVal.enCours}
          texteChargement={t("Validation…", "Approving…")}
          onClick={() =>
            fVal.envoyer(
              { ok: true, charge: { version, acquitte_chiffres: acquitte } },
              (c) => api.post(`/api/capitalisation/retours/${id}/valider`, c),
              {
                ...OPTS,
                succes: t(
                  "Retour d'expérience validé et versé à la base de connaissances.",
                  "Lessons-learned review approved and added to the knowledge base.",
                ),
              },
            )
          }
        >
          {t(`Valider la version ${version}`, `Approve version ${version}`)}
        </Bouton>
      </div>
    </div>
  );
}

export function FormulaireEstimation() {
  const t = useT();
  const langue = useLangue();
  const OPTS = optsLangue(langue);
  const f = useFormulaire<"briques" | "effectif">();
  const [briques, setBriques] = useState("");
  const [effectif, setEffectif] = useState("");
  const [resultat, setResultat] = useState<ReponseEstimation | null>(null);

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await f.envoyer(
      lireEstimation({ briques, effectif }, langue),
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
            libelle={t(
              "Briques (codes séparés par des virgules)",
              "Building blocks (comma-separated codes)",
            )}
            required
            value={briques}
            onChange={(e) => setBriques(e.target.value)}
            erreur={f.erreurs.briques}
          />
          <Champ
            libelle={t(
              "Effectif minimum (3 à 20, 3 par défaut)",
              "Minimum sample size (3 to 20, 3 by default)",
            )}
            inputMode="numeric"
            value={effectif}
            onChange={(e) => setEffectif(e.target.value)}
            erreur={f.erreurs.effectif}
          />
        </div>
        <div className="mp-actions-formulaire">
          <Bouton
            type="submit"
            icone="recherche"
            chargement={f.enCours}
            texteChargement={t("Calcul…", "Computing…")}
          >
            {t("Estimer", "Estimate")}
          </Bouton>
        </div>
      </form>
      {resultat ? (
        <Tableau
          legende={t("Temps réels observés par brique", "Actual time observed per building block")}
          legendeVisible
          cleLigne={(l) => l.brique_code}
          lignes={resultat.elements}
          colonnes={[
            { cle: "brique_code", entete: t("Brique", "Building block") },
            {
              cle: "niveau",
              entete: t("Base", "Basis"),
              rendu: (l) => libelleNiveauEstimation(l.niveau, langue),
            },
            {
              cle: "effectif",
              entete: t("Missions", "Engagements"),
              alignement: "droite",
              rendu: (l) => l.effectif_brique ?? "—",
            },
            {
              cle: "q1",
              entete: t("1er quartile", "1st quartile"),
              alignement: "droite",
              rendu: (l) => l.libelles?.q1 ?? "—",
            },
            {
              cle: "mediane",
              entete: t("Médiane", "Median"),
              alignement: "droite",
              rendu: (l) => l.libelles?.mediane ?? "—",
            },
            {
              cle: "q3",
              entete: t("3e quartile", "3rd quartile"),
              alignement: "droite",
              rendu: (l) => l.libelles?.q3 ?? "—",
            },
          ]}
        />
      ) : null}
    </>
  );
}

const optionsNiveaux = (langue: Langue) =>
  [1, 2, 3, 4].map((n) => ({
    valeur: String(n),
    libelle: libelleNiveauCompetence(n, langue),
  }));

export function FormulaireDeclaration({
  competences,
  collaborateurId,
}: {
  competences: { id: string; libelle: string }[];
  /** Absent : déclaration pour soi. */
  collaborateurId?: string;
}) {
  const t = useT();
  const langue = useLangue();
  const OPTS = optsLangue(langue);
  const f = useFormulaire<"niveau">();
  const [competence, setCompetence] = useState(competences[0]?.id ?? "");
  const [niveau, setNiveau] = useState("");

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const n = lireNiveau(niveau, langue);
    await f.envoyer(
      n,
      (c) =>
        api.post("/api/capitalisation/competences/declarations", {
          competence_id: competence,
          niveau: c.niveau,
          ...(collaborateurId ? { collaborateur_id: collaborateurId } : {}),
        }),
      {
        ...OPTS,
        succes: t(
          "Niveau déclaré : il attend une validation.",
          "Level declared: it awaits approval.",
        ),
      },
    );
  }

  return (
    <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={soumettre}>
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      <div className="mp-grille-champs">
        <Select
          libelle={t("Compétence", "Skill")}
          value={competence}
          onChange={(e) => setCompetence(e.target.value)}
          options={competences.map((c) => ({ valeur: c.id, libelle: c.libelle }))}
        />
        <Select
          libelle={t("Niveau", "Level")}
          value={niveau}
          onChange={(e) => setNiveau(e.target.value)}
          options={[{ valeur: "", libelle: t("Choisir…", "Choose…") }, ...optionsNiveaux(langue)]}
          erreur={f.erreurs.niveau}
        />
      </div>
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          variante="secondaire"
          chargement={f.enCours}
          texteChargement={t("Envoi…", "Sending…")}
        >
          {t("Déclarer", "Declare")}
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
  const t = useT();
  const langue = useLangue();
  const OPTS = optsLangue(langue);
  const f = useFormulaire<"commentaire">();
  const [commentaire, setCommentaire] = useState("");
  const decider = (decision: "validee" | "refusee") =>
    f.envoyer(
      decision === "refusee" && commentaire.trim() === ""
        ? {
            ok: false,
            erreurs: { commentaire: t("Un refus est motivé.", "A refusal must be justified.") },
          }
        : {
            ok: true,
            charge: {
              decision,
              ...(commentaire.trim() ? { commentaire: commentaire.trim() } : {}),
            },
          },
      (c) => api.post(`/api/capitalisation/competences/declarations/${declarationId}/decision`, c),
      {
        ...OPTS,
        succes:
          decision === "validee"
            ? t("Niveau validé.", "Level approved.")
            : t("Déclaration refusée.", "Declaration refused."),
      },
    );
  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={(e) => e.preventDefault()}
    >
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      <p className="mp-texte-petit">
        {t(
          `Niveau déclaré : ${libelleNiveauCompetence(niveau)}`,
          `Declared level: ${libelleNiveauCompetence(niveau, "en")}`,
        )}
      </p>
      <Champ
        libelle={t("Commentaire (obligatoire pour refuser)", "Comment (required to refuse)")}
        maxLength={1000}
        value={commentaire}
        onChange={(e) => setCommentaire(e.target.value)}
        erreur={f.erreurs.commentaire}
      />
      <div className="mp-actions-formulaire">
        <Bouton type="button" chargement={f.enCours} onClick={() => decider("validee")}>
          {t("Valider", "Approve")}
        </Bouton>
        <Bouton
          type="button"
          variante="discret"
          chargement={f.enCours}
          onClick={() => decider("refusee")}
        >
          {t("Refuser", "Refuse")}
        </Bouton>
      </div>
    </form>
  );
}

export function FormulaireCompetence() {
  const t = useT();
  const langue = useLangue();
  const OPTS = optsLangue(langue);
  const f = useFormulaire<"code" | "libelle" | "briques">();
  const [s, setS] = useState({ code: "", libelle: "", briques: "" });
  const [types, setTypes] = useState<string[]>([]);
  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const ok = await f.envoyer(
      lireCompetence(s, langue),
      (c) => api.post("/api/capitalisation/competences", { ...c, types_livrable: types }),
      { ...OPTS, succes: t("Compétence ajoutée au référentiel.", "Skill added to the framework.") },
    );
    if (ok) setS({ code: "", libelle: "", briques: "" });
  }
  const TYPES = [
    ["rapport", t("Rapport", "Report")],
    ["notation", t("Notation", "Rating")],
    ["plan", t("Plan stratégique", "Strategic plan")],
    ["questionnaire", t("Questionnaire", "Questionnaire")],
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
          libelle={t("Libellé", "Label")}
          required
          value={s.libelle}
          onChange={(e) => setS({ ...s, libelle: e.target.value })}
          erreur={f.erreurs.libelle}
        />
      </div>
      <Champ
        libelle={t(
          "Briques qui en apportent la preuve (codes)",
          "Building blocks that provide the evidence (codes)",
        )}
        aide={t(
          "Le temps validé sur une tâche rattachée à ces briques devient une preuve d'usage.",
          "Approved time on a task linked to these building blocks becomes evidence of use.",
        )}
        value={s.briques}
        onChange={(e) => setS({ ...s, briques: e.target.value })}
        erreur={f.erreurs.briques}
      />
      <fieldset className="mp-connaissances__types">
        <legend>
          {t(
            "Livrables rédigés ou relus qui en apportent la preuve",
            "Deliverables written or reviewed that provide the evidence",
          )}
        </legend>
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
          {t("Ajouter la compétence", "Add the skill")}
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
  const t = useT();
  const OPTS = optsLangue(useLangue());
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
          { valeur: "", libelle: t("Aucune brique", "No building block") },
          ...briques.map((b) => ({ valeur: b.code, libelle: `${b.etape} · ${b.libelle}` })),
        ]}
      />
    </div>
  );
}

/**
 * Ouvre le retour d'expérience d'une mission clôturée (rattrapage des missions closes avant
 * l'ouverture automatique), puis mène à son écran. L'API reste juge des droits.
 */
export function BoutonOuvrirRetour({ missionId }: { missionId: string }) {
  const t = useT();
  const OPTS = optsLangue(useLangue());
  const router = useRouter();
  const f = useFormulaire<never>();
  return (
    <div>
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      <Bouton
        variante="secondaire"
        icone="plus"
        chargement={f.enCours}
        texteChargement={t("Ouverture…", "Opening…")}
        onClick={() =>
          f.envoyer(
            { ok: true, charge: null },
            () =>
              api.post<{ id: string }>(
                `/api/capitalisation/missions/${encodeURIComponent(missionId)}/retour`,
              ),
            {
              ...OPTS,
              rafraichir: false,
              apres: (r) => router.push(hrefRetour(r.id)),
            },
          )
        }
      >
        {t("Ouvrir le retour d'expérience", "Open the lessons-learned review")}
      </Bouton>
    </div>
  );
}

export function BoutonProposition({ cle, seuil }: { cle: string; seuil: number }) {
  const t = useT();
  const OPTS = optsLangue(useLangue());
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
            {
              ...OPTS,
              succes: t(
                "Proposition soumise au comité méthode.",
                "Proposal submitted to the method committee.",
              ),
            },
          )
        }
      >
        {t("Proposer au comité méthode", "Propose to the method committee")}
      </Bouton>
    </div>
  );
}

export function BadgeAttente({ libelle }: { libelle: string }) {
  return <BadgeStatut tonalite="attention">{libelle}</BadgeStatut>;
}
