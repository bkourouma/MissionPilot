"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { creerTraduire, type Langue } from "@missionpilot/shared";
import { api } from "../../lib/api";
import {
  libelleSection,
  lireOffreFinanciere,
  lireSectionsOffre,
  messageBanqueAo,
  RACINE_BANQUES,
  SECTIONS_OFFRE_TECHNIQUE,
  type ChoixListe,
  type ResultatOffreFinanciere,
  type SaisieOffreFinanciere,
  type SectionsOffre,
} from "../../lib/banque-ao";
import { DEVISES, type Devise } from "../../lib/format";
import { texteOuNull, type Resultat } from "../../lib/saisie";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import { CaseACocher, GroupeCases } from "../ui/CaseACocher";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";
import { ZoneTexte } from "../ui/ZoneTexte";
import { ResultatFinancier } from "./ResultatFinancier";

/*
 * Formulaires des offres (AO-06, AO-07) : création d'une offre technique (brouillon IA ou
 * gabarit déterministe), modification en nouvelle version, validation humaine ; offre
 * financière (saisie ligne par ligne, aperçu calculé par l'API, enregistrement).
 */

interface SaisieCreation {
  titre: string;
  client: string;
  pays: string;
  secteur: string;
  bailleur: string;
  objectifs: string;
  termes_reference: string;
  methode_version_id: string;
  cv_ids: string[];
  appel_offres_id: string;
  generation: "ia" | "gabarit";
}

type ChampCreation = keyof SaisieCreation;
/** Plafond de l'API (`cv_ids` d'une offre technique). */
const CV_EQUIPE_MAX = 30;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function lireCreation(
  s: SaisieCreation,
  langue: Langue,
): Resultat<Record<string, unknown>, ChampCreation> {
  const t = creerTraduire(langue);
  const erreurs: Partial<Record<ChampCreation, string>> = {};
  if (s.titre.trim() === "")
    erreurs.titre = t("Le titre est obligatoire.", "The title is required.");
  if (s.client.trim() === "")
    erreurs.client = t("Le client est obligatoire.", "The client is required.");
  if (s.termes_reference.trim() === "") {
    erreurs.termes_reference = t(
      "Collez les termes de référence (ou leur résumé).",
      "Paste the terms of reference (or a summary).",
    );
  }
  if (s.pays.trim() !== "" && !/^[A-Za-z]{2}$/.test(s.pays.trim())) {
    erreurs.pays = t("Code à deux lettres.", "Two-letter code.");
  }
  const cvIds = [...new Set(s.cv_ids)];
  if (cvIds.length > CV_EQUIPE_MAX) {
    erreurs.cv_ids = t(
      `${CV_EQUIPE_MAX} CV au plus dans l'équipe.`,
      `${CV_EQUIPE_MAX} CVs at most in the team.`,
    );
  }
  if (s.methode_version_id.trim() !== "" && !UUID.test(s.methode_version_id.trim())) {
    erreurs.methode_version_id = t("Identifiant invalide.", "Invalid identifier.");
  }
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return {
    ok: true,
    charge: {
      titre: s.titre.trim(),
      appel_offres_id: texteOuNull(s.appel_offres_id),
      methode_version_id: texteOuNull(s.methode_version_id),
      cv_ids: cvIds,
      generation: s.generation,
      contexte: {
        client: s.client.trim(),
        pays: s.pays.trim() === "" ? null : s.pays.trim().toUpperCase(),
        secteur: texteOuNull(s.secteur),
        bailleur: texteOuNull(s.bailleur),
        objectifs: texteOuNull(s.objectifs),
        termes_reference: s.termes_reference.trim(),
      },
    },
  };
}

export function FormulaireOffreTechnique({
  redigerIa,
  lierMethode,
  cvChoix,
  fichesChoix,
  cvIdsProposes = [],
}: {
  redigerIa: boolean;
  lierMethode: boolean;
  /** CV de la banque (non anonymisés) proposés pour l'équipe. */
  cvChoix: readonly ChoixListe[];
  /** Fiches d'appels d'offres proposées pour rattacher l'offre. */
  fichesChoix: readonly ChoixListe[];
  cvIdsProposes?: readonly string[];
}) {
  const t = useT();
  const langue = useLangue();
  const router = useRouter();
  const f = useFormulaire<ChampCreation>();
  const [s, setS] = useState<SaisieCreation>({
    titre: "",
    client: "",
    pays: "",
    secteur: "",
    bailleur: "",
    objectifs: "",
    termes_reference: "",
    methode_version_id: "",
    cv_ids: [...cvIdsProposes],
    appel_offres_id: "",
    generation: redigerIa ? "ia" : "gabarit",
  });
  const maj = (cle: ChampCreation) => (e: { target: { value: string } }) =>
    setS((x) => ({ ...x, [cle]: e.target.value }));

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await f.envoyer(
      lireCreation(s, langue),
      (c) => api.post<{ id: string }>("/api/banque-ao/offres-techniques", c, { delaiMs: 120_000 }),
      {
        messageSpecifique: (err) => messageBanqueAo(err, langue),
        rafraichir: false,
        apres: (r) => router.push(`${RACINE_BANQUES}/offres-techniques/${r.id}`),
      },
    );
  }

  return (
    <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={soumettre}>
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      <div className="mp-grille-champs">
        <Champ
          libelle={t("Titre de l'offre", "Bid title")}
          required
          maxLength={300}
          value={s.titre}
          onChange={maj("titre")}
          erreur={f.erreurs.titre}
        />
        <Champ
          libelle={t("Client (autorité contractante)", "Client (contracting authority)")}
          required
          maxLength={200}
          value={s.client}
          onChange={maj("client")}
          erreur={f.erreurs.client}
        />
        <Champ
          libelle={t("Pays", "Country")}
          maxLength={2}
          value={s.pays}
          onChange={maj("pays")}
          erreur={f.erreurs.pays}
        />
        <Champ
          libelle={t("Secteur", "Sector")}
          maxLength={120}
          value={s.secteur}
          onChange={maj("secteur")}
        />
        <Champ
          libelle={t("Bailleur", "Donor")}
          maxLength={120}
          value={s.bailleur}
          onChange={maj("bailleur")}
        />
        <Select
          libelle={t("Rédaction", "Drafting")}
          value={s.generation}
          onChange={maj("generation")}
          options={[
            ...(redigerIa
              ? [
                  {
                    valeur: "ia",
                    libelle: t("Brouillon par l'IA (à valider)", "AI draft (pending approval)"),
                  },
                ]
              : []),
            { valeur: "gabarit", libelle: t("Gabarit déterministe", "Deterministic template") },
          ]}
        />
      </div>
      <ZoneTexte
        libelle={t("Objectifs déclarés", "Stated objectives")}
        maxLength={4000}
        value={s.objectifs}
        onChange={maj("objectifs")}
      />
      <ZoneTexte
        libelle={t("Termes de référence", "Terms of reference")}
        aide={t(
          "Données du client : l'IA les analyse, elle ne les suit jamais comme des consignes.",
          "Client data: the AI analyzes it and never follows it as instructions.",
        )}
        required
        rows={8}
        maxLength={20_000}
        value={s.termes_reference}
        onChange={maj("termes_reference")}
        erreur={f.erreurs.termes_reference}
      />
      <div className="mp-grille-champs">
        {lierMethode ? (
          <Champ
            libelle={t("Version de méthode (identifiant)", "Method version (identifier)")}
            aide={t(
              "Version publiée du référentiel ; vide : démarche générique.",
              "Published framework version; empty: generic approach.",
            )}
            value={s.methode_version_id}
            onChange={maj("methode_version_id")}
            erreur={f.erreurs.methode_version_id}
          />
        ) : null}
        <Select
          libelle={t("Appel d'offres", "Tender")}
          aide={t(
            "Facultatif : rattache l'offre à une fiche.",
            "Optional: links the bid to a record.",
          )}
          invite={t("Aucun appel d'offres", "No tender")}
          value={s.appel_offres_id}
          onChange={maj("appel_offres_id")}
          options={fichesChoix}
          erreur={f.erreurs.appel_offres_id}
        />
      </div>
      {cvChoix.length === 0 ? (
        <p className="mp-texte-doux">
          {t(
            "Aucun CV dans la banque : ajoutez d'abord les CV de l'équipe.",
            "No CVs in the bank: add the team's CVs first.",
          )}
        </p>
      ) : (
        <div className="mp-ao__choix-defilant">
          <GroupeCases
            legende={t("CV de l'équipe", "Team CVs")}
            aide={t(
              "Cochez les experts proposés : l'organisation de l'offre vient de leurs CV.",
              "Tick the proposed experts: the bid's organization comes from their CVs.",
            )}
            nom="cv_ids"
            options={cvChoix}
            valeurs={s.cv_ids}
            onChange={(v) => setS((x) => ({ ...x, cv_ids: v }))}
            erreur={f.erreurs.cv_ids}
          />
        </div>
      )}
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours}>
          {t("Rédiger l'offre", "Draft the bid")}
        </Bouton>
      </div>
    </form>
  );
}

export function FormulaireVersionOffre({
  offreId,
  sections,
}: {
  offreId: string;
  sections: SectionsOffre;
}) {
  const t = useT();
  const langue = useLangue();
  const f = useFormulaire<keyof SectionsOffre | "motif">();
  const [s, setS] = useState<SectionsOffre & { motif: string }>({ ...sections, motif: "" });

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await f.envoyer(
      lireSectionsOffre(s, langue),
      (c) => api.post(`/api/banque-ao/offres-techniques/${offreId}/versions`, c),
      {
        succes: t(
          "Nouvelle version enregistrée : à valider.",
          "New version saved: pending approval.",
        ),
        messageSpecifique: (err) => messageBanqueAo(err, langue),
      },
    );
  }

  return (
    <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={soumettre}>
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      {SECTIONS_OFFRE_TECHNIQUE.map((cle) => (
        <ZoneTexte
          key={cle}
          libelle={libelleSection(cle, langue)}
          required
          rows={8}
          maxLength={20_000}
          value={s[cle]}
          onChange={(e) => setS((x) => ({ ...x, [cle]: e.target.value }))}
          erreur={f.erreurs[cle]}
        />
      ))}
      <Champ
        libelle={t("Motif de la modification", "Reason for the change")}
        required
        maxLength={500}
        value={s.motif}
        onChange={(e) => setS((x) => ({ ...x, motif: e.target.value }))}
        erreur={f.erreurs.motif}
      />
      <div className="mp-actions-formulaire">
        <Bouton type="submit" variante="secondaire" chargement={f.enCours}>
          {t("Enregistrer la modification", "Save the change")}
        </Bouton>
      </div>
    </form>
  );
}

export const MESSAGE_VALIDATION_IMPOSSIBLE =
  "Vous avez demandé ou rédigé cette offre : elle doit être validée par un autre utilisateur ou par un associé (séparation des tâches).";

export const MESSAGE_VALIDATION_IMPOSSIBLE_EN =
  "You requested or drafted this bid: it must be approved by another user or by a partner (separation of duties).";

export function FormulaireValidationOffre({
  offreId,
  version,
  nombresAAcquitter,
  peutValider = true,
}: {
  offreId: string;
  version: number;
  nombresAAcquitter: readonly string[];
  /** Faux : séparation des tâches, le bouton est désactivé et la raison affichée. */
  peutValider?: boolean;
}) {
  const t = useT();
  const langue = useLangue();
  const f = useFormulaire<"acquitte">();
  const [acquitte, setAcquitte] = useState(false);

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const validation: Resultat<{ version: number; acquitte_chiffres?: boolean }, "acquitte"> =
      nombresAAcquitter.length > 0 && !acquitte
        ? {
            ok: false,
            erreurs: {
              acquitte: t(
                "Relisez puis acquittez les nombres signalés.",
                "Review and acknowledge the flagged numbers.",
              ),
            },
          }
        : {
            ok: true,
            charge: {
              version,
              ...(nombresAAcquitter.length > 0 ? { acquitte_chiffres: true } : {}),
            },
          };
    await f.envoyer(
      validation,
      (c) => api.post(`/api/banque-ao/offres-techniques/${offreId}/validation`, c),
      {
        succes: t("Version validée.", "Version approved."),
        messageSpecifique: (err) => messageBanqueAo(err, langue),
      },
    );
  }

  return (
    <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={soumettre}>
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      {peutValider ? null : (
        <Alerte tonalite="info" annonce="aucune">
          <p>{t(MESSAGE_VALIDATION_IMPOSSIBLE, MESSAGE_VALIDATION_IMPOSSIBLE_EN)}</p>
        </Alerte>
      )}
      {nombresAAcquitter.length > 0 ? (
        <CaseACocher
          libelle={t(
            `J'ai vérifié les nombres cités par l'IA : ${nombresAAcquitter.join(", ")}`,
            `I have verified the numbers cited by the AI: ${nombresAAcquitter.join(", ")}`,
          )}
          checked={acquitte}
          onChange={(e) => setAcquitte(e.target.checked)}
          aide={f.erreurs.acquitte}
          disabled={!peutValider}
        />
      ) : null}
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} disabled={!peutValider}>
          {t(`Valider la version ${version}`, `Approve version ${version}`)}
        </Bouton>
      </div>
    </form>
  );
}

const SAISIE_FINANCIERE: SaisieOffreFinanciere = {
  titre: "",
  devise: "XOF",
  honoraires: "",
  per_diem: "",
  debours: "",
  tva: "18",
};

export function FormulaireOffreFinanciere({
  offreId,
  initial,
}: {
  offreId?: string;
  initial?: SaisieOffreFinanciere;
}) {
  const t = useT();
  const langue = useLangue();
  const router = useRouter();
  const f = useFormulaire<keyof SaisieOffreFinanciere | "motif">();
  const [s, setS] = useState<SaisieOffreFinanciere>(initial ?? SAISIE_FINANCIERE);
  const [motif, setMotif] = useState("");
  const [apercu, setApercu] = useState<ResultatOffreFinanciere | null>(null);
  const maj = (cle: keyof SaisieOffreFinanciere) => (e: { target: { value: string } }) =>
    setS((x) => ({ ...x, [cle]: e.target.value }));

  async function simuler() {
    const lu = lireOffreFinanciere({ ...s, titre: s.titre || "Aperçu" }, langue);
    await f.envoyer(
      lu,
      (c) =>
        api.post<ResultatOffreFinanciere>("/api/banque-ao/offres-financieres/simulation", c.entree),
      {
        rafraichir: false,
        apres: setApercu,
        messageSpecifique: (err) => messageBanqueAo(err, langue),
      },
    );
  }

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const lu = lireOffreFinanciere({ ...s, titre: offreId ? s.titre || "—" : s.titre }, langue);
    if (offreId) {
      const m = motif.trim();
      const validation: Resultat<
        { entree: Record<string, unknown>; motif: string },
        keyof SaisieOffreFinanciere | "motif"
      > = !lu.ok
        ? { ok: false, erreurs: lu.erreurs }
        : m === ""
          ? {
              ok: false,
              erreurs: { motif: t("Le motif est obligatoire.", "The reason is required.") },
            }
          : { ok: true, charge: { entree: lu.charge.entree, motif: m } };
      await f.envoyer(
        validation,
        (c) => api.post(`/api/banque-ao/offres-financieres/${offreId}/versions`, c),
        {
          succes: t("Nouvelle version enregistrée.", "New version saved."),
          messageSpecifique: (err) => messageBanqueAo(err, langue),
        },
      );
      return;
    }
    await f.envoyer(lu, (c) => api.post<{ id: string }>("/api/banque-ao/offres-financieres", c), {
      messageSpecifique: (err) => messageBanqueAo(err, langue),
      rafraichir: false,
      apres: (r) => router.push(`${RACINE_BANQUES}/offres-financieres/${r.id}`),
    });
  }

  return (
    <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={soumettre}>
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      <div className="mp-grille-champs">
        {offreId ? null : (
          <Champ
            libelle={t("Titre de l'offre", "Bid title")}
            required
            maxLength={300}
            value={s.titre}
            onChange={maj("titre")}
            erreur={f.erreurs.titre}
          />
        )}
        <Select
          libelle={t("Devise", "Currency")}
          value={s.devise}
          onChange={(e) => setS((x) => ({ ...x, devise: e.target.value as Devise }))}
          options={DEVISES.map((d) => ({ valeur: d, libelle: d }))}
        />
        <Champ
          libelle={t("TVA (%)", "VAT (%)")}
          inputMode="decimal"
          aide={t("Vide ou 0 : offre hors taxes.", "Empty or 0: bid excluding tax.")}
          value={s.tva}
          onChange={maj("tva")}
          erreur={f.erreurs.tva}
        />
      </div>
      <ZoneTexte
        libelle={t("Honoraires", "Fees")}
        aide={t(
          "Une ligne par expert : clé | libellé | jours (0,5 j) | taux journalier.",
          "One line per expert: key | label | days (0.5 d) | daily rate.",
        )}
        rows={5}
        value={s.honoraires}
        onChange={maj("honoraires")}
        erreur={f.erreurs.honoraires}
      />
      <ZoneTexte
        libelle="Per diem"
        aide={t(
          "Une ligne : libellé | nombre de jours | montant journalier.",
          "One line: label | number of days | daily amount.",
        )}
        rows={3}
        value={s.per_diem}
        onChange={maj("per_diem")}
        erreur={f.erreurs.per_diem}
      />
      <ZoneTexte
        libelle={t("Débours", "Expenses")}
        aide={t(
          "Une ligne : libellé | quantité | prix unitaire.",
          "One line: label | quantity | unit price.",
        )}
        rows={3}
        value={s.debours}
        onChange={maj("debours")}
        erreur={f.erreurs.debours}
      />
      {offreId ? (
        <Champ
          libelle={t("Motif de la nouvelle version", "Reason for the new version")}
          required
          maxLength={500}
          value={motif}
          onChange={(e) => setMotif(e.target.value)}
          erreur={f.erreurs.motif}
        />
      ) : null}
      <div className="mp-actions-formulaire">
        <Bouton type="button" variante="secondaire" chargement={f.enCours} onClick={simuler}>
          {t("Calculer l'aperçu", "Compute the preview")}
        </Bouton>
        <Bouton type="submit" chargement={f.enCours}>
          {offreId
            ? t("Enregistrer la nouvelle version", "Save the new version")
            : t("Enregistrer l'offre", "Save the bid")}
        </Bouton>
      </div>
      {apercu ? (
        <ResultatFinancier
          resultat={apercu}
          titre={t("Aperçu (non enregistré)", "Preview (not saved)")}
          langue={langue}
        />
      ) : null}
    </form>
  );
}
