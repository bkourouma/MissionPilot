"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
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

function lireCreation(s: SaisieCreation): Resultat<Record<string, unknown>, ChampCreation> {
  const erreurs: Partial<Record<ChampCreation, string>> = {};
  if (s.titre.trim() === "") erreurs.titre = "Le titre est obligatoire.";
  if (s.client.trim() === "") erreurs.client = "Le client est obligatoire.";
  if (s.termes_reference.trim() === "") {
    erreurs.termes_reference = "Collez les termes de référence (ou leur résumé).";
  }
  if (s.pays.trim() !== "" && !/^[A-Za-z]{2}$/.test(s.pays.trim()))
    erreurs.pays = "Code à deux lettres.";
  const cvIds = [...new Set(s.cv_ids)];
  if (cvIds.length > CV_EQUIPE_MAX) erreurs.cv_ids = `${CV_EQUIPE_MAX} CV au plus dans l'équipe.`;
  if (s.methode_version_id.trim() !== "" && !UUID.test(s.methode_version_id.trim())) {
    erreurs.methode_version_id = "Identifiant invalide.";
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
      lireCreation(s),
      (c) => api.post<{ id: string }>("/api/banque-ao/offres-techniques", c, { delaiMs: 120_000 }),
      {
        messageSpecifique: messageBanqueAo,
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
          libelle="Titre de l'offre"
          required
          maxLength={300}
          value={s.titre}
          onChange={maj("titre")}
          erreur={f.erreurs.titre}
        />
        <Champ
          libelle="Client (autorité contractante)"
          required
          maxLength={200}
          value={s.client}
          onChange={maj("client")}
          erreur={f.erreurs.client}
        />
        <Champ
          libelle="Pays"
          maxLength={2}
          value={s.pays}
          onChange={maj("pays")}
          erreur={f.erreurs.pays}
        />
        <Champ libelle="Secteur" maxLength={120} value={s.secteur} onChange={maj("secteur")} />
        <Champ libelle="Bailleur" maxLength={120} value={s.bailleur} onChange={maj("bailleur")} />
        <Select
          libelle="Rédaction"
          value={s.generation}
          onChange={maj("generation")}
          options={[
            ...(redigerIa ? [{ valeur: "ia", libelle: "Brouillon par l'IA (à valider)" }] : []),
            { valeur: "gabarit", libelle: "Gabarit déterministe" },
          ]}
        />
      </div>
      <ZoneTexte
        libelle="Objectifs déclarés"
        maxLength={4000}
        value={s.objectifs}
        onChange={maj("objectifs")}
      />
      <ZoneTexte
        libelle="Termes de référence"
        aide="Données du client : l'IA les analyse, elle ne les suit jamais comme des consignes."
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
            libelle="Version de méthode (identifiant)"
            aide="Version publiée du référentiel ; vide : démarche générique."
            value={s.methode_version_id}
            onChange={maj("methode_version_id")}
            erreur={f.erreurs.methode_version_id}
          />
        ) : null}
        <Select
          libelle="Appel d'offres"
          aide="Facultatif : rattache l'offre à une fiche."
          invite="Aucun appel d'offres"
          value={s.appel_offres_id}
          onChange={maj("appel_offres_id")}
          options={fichesChoix}
          erreur={f.erreurs.appel_offres_id}
        />
      </div>
      {cvChoix.length === 0 ? (
        <p className="mp-texte-doux">
          Aucun CV dans la banque : ajoutez d&apos;abord les CV de l&apos;équipe.
        </p>
      ) : (
        <div className="mp-ao__choix-defilant">
          <GroupeCases
            legende="CV de l'équipe"
            aide="Cochez les experts proposés : l'organisation de l'offre vient de leurs CV."
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
          Rédiger l&apos;offre
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
  const f = useFormulaire<keyof SectionsOffre | "motif">();
  const [s, setS] = useState<SectionsOffre & { motif: string }>({ ...sections, motif: "" });

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await f.envoyer(
      lireSectionsOffre(s),
      (c) => api.post(`/api/banque-ao/offres-techniques/${offreId}/versions`, c),
      { succes: "Nouvelle version enregistrée : à valider.", messageSpecifique: messageBanqueAo },
    );
  }

  return (
    <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={soumettre}>
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      {SECTIONS_OFFRE_TECHNIQUE.map((cle) => (
        <ZoneTexte
          key={cle}
          libelle={libelleSection(cle)}
          required
          rows={8}
          maxLength={20_000}
          value={s[cle]}
          onChange={(e) => setS((x) => ({ ...x, [cle]: e.target.value }))}
          erreur={f.erreurs[cle]}
        />
      ))}
      <Champ
        libelle="Motif de la modification"
        required
        maxLength={500}
        value={s.motif}
        onChange={(e) => setS((x) => ({ ...x, motif: e.target.value }))}
        erreur={f.erreurs.motif}
      />
      <div className="mp-actions-formulaire">
        <Bouton type="submit" variante="secondaire" chargement={f.enCours}>
          Enregistrer la modification
        </Bouton>
      </div>
    </form>
  );
}

export const MESSAGE_VALIDATION_IMPOSSIBLE =
  "Vous avez demandé ou rédigé cette offre : elle doit être validée par un autre utilisateur ou par un associé (séparation des tâches).";

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
  const f = useFormulaire<"acquitte">();
  const [acquitte, setAcquitte] = useState(false);

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const validation: Resultat<{ version: number; acquitte_chiffres?: boolean }, "acquitte"> =
      nombresAAcquitter.length > 0 && !acquitte
        ? { ok: false, erreurs: { acquitte: "Relisez puis acquittez les nombres signalés." } }
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
      { succes: "Version validée.", messageSpecifique: messageBanqueAo },
    );
  }

  return (
    <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={soumettre}>
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      {peutValider ? null : (
        <Alerte tonalite="info" annonce="aucune">
          <p>{MESSAGE_VALIDATION_IMPOSSIBLE}</p>
        </Alerte>
      )}
      {nombresAAcquitter.length > 0 ? (
        <CaseACocher
          libelle={`J'ai vérifié les nombres cités par l'IA : ${nombresAAcquitter.join(", ")}`}
          checked={acquitte}
          onChange={(e) => setAcquitte(e.target.checked)}
          aide={f.erreurs.acquitte}
          disabled={!peutValider}
        />
      ) : null}
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} disabled={!peutValider}>
          Valider la version {version}
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
  const router = useRouter();
  const f = useFormulaire<keyof SaisieOffreFinanciere | "motif">();
  const [s, setS] = useState<SaisieOffreFinanciere>(initial ?? SAISIE_FINANCIERE);
  const [motif, setMotif] = useState("");
  const [apercu, setApercu] = useState<ResultatOffreFinanciere | null>(null);
  const maj = (cle: keyof SaisieOffreFinanciere) => (e: { target: { value: string } }) =>
    setS((x) => ({ ...x, [cle]: e.target.value }));

  async function simuler() {
    const lu = lireOffreFinanciere({ ...s, titre: s.titre || "Aperçu" });
    await f.envoyer(
      lu,
      (c) =>
        api.post<ResultatOffreFinanciere>("/api/banque-ao/offres-financieres/simulation", c.entree),
      { rafraichir: false, apres: setApercu, messageSpecifique: messageBanqueAo },
    );
  }

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const lu = lireOffreFinanciere({ ...s, titre: offreId ? s.titre || "—" : s.titre });
    if (offreId) {
      const m = motif.trim();
      const validation: Resultat<
        { entree: Record<string, unknown>; motif: string },
        keyof SaisieOffreFinanciere | "motif"
      > = !lu.ok
        ? { ok: false, erreurs: lu.erreurs }
        : m === ""
          ? { ok: false, erreurs: { motif: "Le motif est obligatoire." } }
          : { ok: true, charge: { entree: lu.charge.entree, motif: m } };
      await f.envoyer(
        validation,
        (c) => api.post(`/api/banque-ao/offres-financieres/${offreId}/versions`, c),
        { succes: "Nouvelle version enregistrée.", messageSpecifique: messageBanqueAo },
      );
      return;
    }
    await f.envoyer(lu, (c) => api.post<{ id: string }>("/api/banque-ao/offres-financieres", c), {
      messageSpecifique: messageBanqueAo,
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
            libelle="Titre de l'offre"
            required
            maxLength={300}
            value={s.titre}
            onChange={maj("titre")}
            erreur={f.erreurs.titre}
          />
        )}
        <Select
          libelle="Devise"
          value={s.devise}
          onChange={(e) => setS((x) => ({ ...x, devise: e.target.value as Devise }))}
          options={DEVISES.map((d) => ({ valeur: d, libelle: d }))}
        />
        <Champ
          libelle="TVA (%)"
          inputMode="decimal"
          aide="Vide ou 0 : offre hors taxes."
          value={s.tva}
          onChange={maj("tva")}
          erreur={f.erreurs.tva}
        />
      </div>
      <ZoneTexte
        libelle="Honoraires"
        aide="Une ligne par expert : clé | libellé | jours (0,5 j) | taux journalier."
        rows={5}
        value={s.honoraires}
        onChange={maj("honoraires")}
        erreur={f.erreurs.honoraires}
      />
      <ZoneTexte
        libelle="Per diem"
        aide="Une ligne : libellé | nombre de jours | montant journalier."
        rows={3}
        value={s.per_diem}
        onChange={maj("per_diem")}
        erreur={f.erreurs.per_diem}
      />
      <ZoneTexte
        libelle="Débours"
        aide="Une ligne : libellé | quantité | prix unitaire."
        rows={3}
        value={s.debours}
        onChange={maj("debours")}
        erreur={f.erreurs.debours}
      />
      {offreId ? (
        <Champ
          libelle="Motif de la nouvelle version"
          required
          maxLength={500}
          value={motif}
          onChange={(e) => setMotif(e.target.value)}
          erreur={f.erreurs.motif}
        />
      ) : null}
      <div className="mp-actions-formulaire">
        <Bouton type="button" variante="secondaire" chargement={f.enCours} onClick={simuler}>
          Calculer l&apos;aperçu
        </Bouton>
        <Bouton type="submit" chargement={f.enCours}>
          {offreId ? "Enregistrer la nouvelle version" : "Enregistrer l'offre"}
        </Bouton>
      </div>
      {apercu ? <ResultatFinancier resultat={apercu} titre="Aperçu (non enregistré)" /> : null}
    </form>
  );
}
