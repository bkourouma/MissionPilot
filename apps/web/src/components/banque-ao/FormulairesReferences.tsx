"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ROLES_CABINET_REFERENCE, TYPES_ATTESTATION } from "@missionpilot/shared";
import { api, messageErreur } from "../../lib/api";
import { lireMotif } from "../../lib/agents";
import {
  libelleRoleReference,
  libelleTypeAttestation,
  lireReference,
  messageBanqueAo,
  RACINE_BANQUES,
  type SaisieReference,
} from "../../lib/banque-ao";
import { controlerFichier, messageTeleversement, type FichierTeleverse } from "../../lib/fichiers";
import { DEVISES, type Devise } from "../../lib/format";
import { aideMontant, type Resultat } from "../../lib/saisie";
import { televerser } from "../../lib/televersement";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";
import { ZoneTexte } from "../ui/ZoneTexte";

/*
 * Formulaires de la banque de références (AO-05) : création et nouvelle version, pièce
 * justificative (téléversement par /api/fichiers puis rattachement), retrait motivé.
 */

const VIDE: SaisieReference = {
  titre: "",
  client_nom: "",
  pays: "",
  secteurs: "",
  bailleur: "",
  montant: "",
  devise: "XOF",
  date_debut: "",
  date_fin: "",
  role_cabinet: "seul",
  description: "",
};

export function FormulaireReference({
  referenceId,
  initial,
}: {
  referenceId?: string;
  initial?: SaisieReference;
}) {
  const t = useT();
  const langue = useLangue();
  const router = useRouter();
  const f = useFormulaire<keyof SaisieReference | "motif">();
  const [s, setS] = useState<SaisieReference>(initial ?? VIDE);
  const [motif, setMotif] = useState("");
  const maj = (cle: keyof SaisieReference) => (e: { target: { value: string } }) =>
    setS((x) => ({ ...x, [cle]: e.target.value }));

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const lu = lireReference(s, langue);
    if (referenceId) {
      const m = lireMotif(motif, 500, langue);
      const validation: Resultat<
        { contenu: Record<string, unknown>; motif: string },
        keyof SaisieReference | "motif"
      > = !lu.ok
        ? { ok: false, erreurs: lu.erreurs }
        : !m.ok
          ? { ok: false, erreurs: m.erreurs }
          : { ok: true, charge: { contenu: lu.charge, motif: m.charge.motif } };
      await f.envoyer(
        validation,
        (c) => api.post(`/api/banque-ao/references/${referenceId}/versions`, c),
        {
          succes: t("Nouvelle version enregistrée.", "New version saved."),
          messageSpecifique: (err) => messageBanqueAo(err, langue),
        },
      );
      return;
    }
    await f.envoyer(lu, (c) => api.post<{ id: string }>("/api/banque-ao/references", c), {
      messageSpecifique: (err) => messageBanqueAo(err, langue),
      rafraichir: false,
      apres: (r) => router.push(`${RACINE_BANQUES}/references/${r.id}`),
    });
  }

  return (
    <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={soumettre}>
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      <div className="mp-grille-champs">
        <Champ
          libelle={t("Intitulé de la mission", "Engagement title")}
          required
          maxLength={300}
          value={s.titre}
          onChange={maj("titre")}
          erreur={f.erreurs.titre}
        />
        <Champ
          libelle={t("Client", "Client")}
          required
          maxLength={200}
          value={s.client_nom}
          onChange={maj("client_nom")}
          erreur={f.erreurs.client_nom}
        />
        <Champ
          libelle={t("Pays", "Country")}
          aide={t("Code à deux lettres (CI, SN, BF…).", "Two-letter code (CI, SN, BF…).")}
          required
          maxLength={2}
          value={s.pays}
          onChange={maj("pays")}
          erreur={f.erreurs.pays}
        />
        <Champ
          libelle={t("Secteurs", "Sectors")}
          aide={t("Séparés par des virgules.", "Separated by commas.")}
          value={s.secteurs}
          onChange={maj("secteurs")}
        />
        <Champ
          libelle={t("Bailleur", "Donor")}
          maxLength={120}
          value={s.bailleur}
          onChange={maj("bailleur")}
        />
        <Select
          libelle={t("Devise", "Currency")}
          value={s.devise}
          onChange={(e) => setS((x) => ({ ...x, devise: e.target.value as Devise }))}
          options={DEVISES.map((d) => ({ valeur: d, libelle: d }))}
        />
        <Champ
          libelle={t("Montant du marché", "Contract amount")}
          aide={aideMontant(s.devise, langue)}
          inputMode="decimal"
          required
          value={s.montant}
          onChange={maj("montant")}
          erreur={f.erreurs.montant}
        />
        <Champ
          libelle={t("Début", "Start")}
          type="date"
          required
          value={s.date_debut}
          onChange={maj("date_debut")}
          erreur={f.erreurs.date_debut}
        />
        <Champ
          libelle={t("Fin", "End")}
          type="date"
          value={s.date_fin}
          onChange={maj("date_fin")}
          erreur={f.erreurs.date_fin}
        />
        <Select
          libelle={t("Rôle du cabinet", "Firm's role")}
          value={s.role_cabinet}
          onChange={maj("role_cabinet")}
          erreur={f.erreurs.role_cabinet}
          options={ROLES_CABINET_REFERENCE.map((r) => ({
            valeur: r,
            libelle: libelleRoleReference(r, langue),
          }))}
        />
      </div>
      <ZoneTexte
        libelle={t("Description", "Description")}
        maxLength={4000}
        value={s.description}
        onChange={maj("description")}
      />
      {referenceId ? (
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
        <Bouton type="submit" chargement={f.enCours}>
          {referenceId
            ? t("Enregistrer la nouvelle version", "Save the new version")
            : t("Créer la référence", "Create the reference")}
        </Bouton>
      </div>
    </form>
  );
}

/** Téléverse le fichier (non rattaché) puis le rattache comme pièce de la référence. */
export function FormulairePiece({ referenceId }: { referenceId: string }) {
  const t = useT();
  const langue = useLangue();
  const f = useFormulaire<"fichier" | "date_attestation" | "emetteur">();
  const [fichier, setFichier] = useState<File | null>(null);
  const [type, setType] = useState<string>(TYPES_ATTESTATION[0]);
  const [date, setDate] = useState("");
  const [emetteur, setEmetteur] = useState("");
  // Le champ fichier n'est pas contrôlé : changer sa clé le remonte, donc le vide.
  const [cleFichier, setCleFichier] = useState(0);

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const erreurs: Partial<Record<"fichier" | "date_attestation" | "emetteur", string>> = {};
    const controle = fichier ? controlerFichier(fichier, undefined, undefined, langue) : null;
    if (!fichier)
      erreurs.fichier = t("Choisissez le fichier de la pièce.", "Choose the document file.");
    else if (controle && !controle.ok) erreurs.fichier = controle.message;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      erreurs.date_attestation = t("Date obligatoire.", "The date is required.");
    }
    if (emetteur.trim() === "")
      erreurs.emetteur = t("L'émetteur est obligatoire.", "The issuer is required.");
    const validation =
      Object.keys(erreurs).length > 0 || !fichier
        ? { ok: false as const, erreurs }
        : { ok: true as const, charge: { fichier, date, emetteur: emetteur.trim() } };
    const ok = await f.envoyer(
      validation,
      async (c) => {
        const envoye = await televerser<FichierTeleverse>(
          "/api/fichiers",
          c.fichier,
          c.fichier.name,
        );
        return api.post(`/api/banque-ao/references/${referenceId}/attestations`, {
          fichier_id: envoye.id,
          type,
          date_attestation: c.date,
          emetteur: c.emetteur,
        });
      },
      {
        succes: t("Pièce ajoutée.", "Document added."),
        // Erreur propre à la banque (déjà rattaché…) sinon message du téléversement.
        messageSpecifique: (err) => {
          const propre = messageBanqueAo(err, langue);
          return propre !== messageErreur(err, langue) ? propre : messageTeleversement(err, langue);
        },
      },
    );
    if (ok) {
      // Tout le formulaire repart à vide (fichier compris), prêt pour la pièce suivante.
      setFichier(null);
      setCleFichier((n) => n + 1);
      setType(TYPES_ATTESTATION[0]);
      setDate("");
      setEmetteur("");
    }
  }

  return (
    <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={soumettre}>
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      <div className="mp-grille-champs">
        <Champ
          key={cleFichier}
          libelle={t("Fichier", "File")}
          type="file"
          required
          onChange={(e) => setFichier(e.target.files?.[0] ?? null)}
          erreur={f.erreurs.fichier}
        />
        <Select
          libelle={t("Nature de la pièce", "Document type")}
          value={type}
          onChange={(e) => setType(e.target.value)}
          options={TYPES_ATTESTATION.map((ty) => ({
            valeur: ty,
            libelle: libelleTypeAttestation(ty, langue),
          }))}
        />
        <Champ
          libelle={t("Date de la pièce", "Document date")}
          type="date"
          required
          value={date}
          onChange={(e) => setDate(e.target.value)}
          erreur={f.erreurs.date_attestation}
        />
        <Champ
          libelle={t("Émetteur", "Issuer")}
          required
          maxLength={200}
          value={emetteur}
          onChange={(e) => setEmetteur(e.target.value)}
          erreur={f.erreurs.emetteur}
        />
      </div>
      <div className="mp-actions-formulaire">
        <Bouton type="submit" variante="secondaire" chargement={f.enCours}>
          {t("Ajouter la pièce", "Add the document")}
        </Bouton>
      </div>
    </form>
  );
}

export function FormulaireRetraitPiece({ attestationId }: { attestationId: string }) {
  const t = useT();
  const langue = useLangue();
  const f = useFormulaire<"motif">();
  const [motif, setMotif] = useState("");

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await f.envoyer(
      lireMotif(motif, 500, langue),
      (c) => api.post(`/api/banque-ao/attestations/${attestationId}/retrait`, c),
      {
        succes: t("Pièce retirée.", "Document withdrawn."),
        messageSpecifique: (err) => messageBanqueAo(err, langue),
      },
    );
  }

  return (
    <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={soumettre}>
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      <Champ
        libelle={t("Motif du retrait", "Reason for withdrawal")}
        required
        maxLength={500}
        value={motif}
        onChange={(e) => setMotif(e.target.value)}
        erreur={f.erreurs.motif}
      />
      <div className="mp-actions-formulaire">
        <Bouton type="submit" variante="danger" chargement={f.enCours}>
          {t("Retirer la pièce", "Withdraw the document")}
        </Bouton>
      </div>
    </form>
  );
}
