"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import {
  LIBELLES_ROLE_REFERENCE,
  LIBELLES_TYPE_ATTESTATION,
  ROLES_CABINET_REFERENCE,
  TYPES_ATTESTATION,
} from "@missionpilot/shared";
import { api, messageErreur } from "../../lib/api";
import { lireMotif } from "../../lib/agents";
import {
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
  const router = useRouter();
  const f = useFormulaire<keyof SaisieReference | "motif">();
  const [s, setS] = useState<SaisieReference>(initial ?? VIDE);
  const [motif, setMotif] = useState("");
  const maj = (cle: keyof SaisieReference) => (e: { target: { value: string } }) =>
    setS((x) => ({ ...x, [cle]: e.target.value }));

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const lu = lireReference(s);
    if (referenceId) {
      const m = lireMotif(motif, 500);
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
        { succes: "Nouvelle version enregistrée.", messageSpecifique: messageBanqueAo },
      );
      return;
    }
    await f.envoyer(lu, (c) => api.post<{ id: string }>("/api/banque-ao/references", c), {
      messageSpecifique: messageBanqueAo,
      rafraichir: false,
      apres: (r) => router.push(`${RACINE_BANQUES}/references/${r.id}`),
    });
  }

  return (
    <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={soumettre}>
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      <div className="mp-grille-champs">
        <Champ
          libelle="Intitulé de la mission"
          required
          maxLength={300}
          value={s.titre}
          onChange={maj("titre")}
          erreur={f.erreurs.titre}
        />
        <Champ
          libelle="Client"
          required
          maxLength={200}
          value={s.client_nom}
          onChange={maj("client_nom")}
          erreur={f.erreurs.client_nom}
        />
        <Champ
          libelle="Pays"
          aide="Code à deux lettres (CI, SN, BF…)."
          required
          maxLength={2}
          value={s.pays}
          onChange={maj("pays")}
          erreur={f.erreurs.pays}
        />
        <Champ
          libelle="Secteurs"
          aide="Séparés par des virgules."
          value={s.secteurs}
          onChange={maj("secteurs")}
        />
        <Champ libelle="Bailleur" maxLength={120} value={s.bailleur} onChange={maj("bailleur")} />
        <Select
          libelle="Devise"
          value={s.devise}
          onChange={(e) => setS((x) => ({ ...x, devise: e.target.value as Devise }))}
          options={DEVISES.map((d) => ({ valeur: d, libelle: d }))}
        />
        <Champ
          libelle="Montant du marché"
          aide={aideMontant(s.devise)}
          inputMode="decimal"
          required
          value={s.montant}
          onChange={maj("montant")}
          erreur={f.erreurs.montant}
        />
        <Champ
          libelle="Début"
          type="date"
          required
          value={s.date_debut}
          onChange={maj("date_debut")}
          erreur={f.erreurs.date_debut}
        />
        <Champ
          libelle="Fin"
          type="date"
          value={s.date_fin}
          onChange={maj("date_fin")}
          erreur={f.erreurs.date_fin}
        />
        <Select
          libelle="Rôle du cabinet"
          value={s.role_cabinet}
          onChange={maj("role_cabinet")}
          erreur={f.erreurs.role_cabinet}
          options={ROLES_CABINET_REFERENCE.map((r) => ({
            valeur: r,
            libelle: LIBELLES_ROLE_REFERENCE[r],
          }))}
        />
      </div>
      <ZoneTexte
        libelle="Description"
        maxLength={4000}
        value={s.description}
        onChange={maj("description")}
      />
      {referenceId ? (
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
        <Bouton type="submit" chargement={f.enCours}>
          {referenceId ? "Enregistrer la nouvelle version" : "Créer la référence"}
        </Bouton>
      </div>
    </form>
  );
}

/** Téléverse le fichier (non rattaché) puis le rattache comme pièce de la référence. */
export function FormulairePiece({ referenceId }: { referenceId: string }) {
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
    const controle = fichier ? controlerFichier(fichier) : null;
    if (!fichier) erreurs.fichier = "Choisissez le fichier de la pièce.";
    else if (controle && !controle.ok) erreurs.fichier = controle.message;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) erreurs.date_attestation = "Date obligatoire.";
    if (emetteur.trim() === "") erreurs.emetteur = "L'émetteur est obligatoire.";
    const validation =
      Object.keys(erreurs).length > 0 || !fichier
        ? { ok: false as const, erreurs }
        : { ok: true as const, charge: { fichier, date, emetteur: emetteur.trim() } };
    const ok = await f.envoyer(
      validation,
      async (c) => {
        const t = await televerser<FichierTeleverse>("/api/fichiers", c.fichier, c.fichier.name);
        return api.post(`/api/banque-ao/references/${referenceId}/attestations`, {
          fichier_id: t.id,
          type,
          date_attestation: c.date,
          emetteur: c.emetteur,
        });
      },
      {
        succes: "Pièce ajoutée.",
        // Erreur propre à la banque (déjà rattaché…) sinon message du téléversement.
        messageSpecifique: (err) => {
          const propre = messageBanqueAo(err);
          return propre !== messageErreur(err) ? propre : messageTeleversement(err);
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
          libelle="Fichier"
          type="file"
          required
          onChange={(e) => setFichier(e.target.files?.[0] ?? null)}
          erreur={f.erreurs.fichier}
        />
        <Select
          libelle="Nature de la pièce"
          value={type}
          onChange={(e) => setType(e.target.value)}
          options={TYPES_ATTESTATION.map((t) => ({
            valeur: t,
            libelle: LIBELLES_TYPE_ATTESTATION[t],
          }))}
        />
        <Champ
          libelle="Date de la pièce"
          type="date"
          required
          value={date}
          onChange={(e) => setDate(e.target.value)}
          erreur={f.erreurs.date_attestation}
        />
        <Champ
          libelle="Émetteur"
          required
          maxLength={200}
          value={emetteur}
          onChange={(e) => setEmetteur(e.target.value)}
          erreur={f.erreurs.emetteur}
        />
      </div>
      <div className="mp-actions-formulaire">
        <Bouton type="submit" variante="secondaire" chargement={f.enCours}>
          Ajouter la pièce
        </Bouton>
      </div>
    </form>
  );
}

export function FormulaireRetraitPiece({ attestationId }: { attestationId: string }) {
  const f = useFormulaire<"motif">();
  const [motif, setMotif] = useState("");

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await f.envoyer(
      lireMotif(motif, 500),
      (c) => api.post(`/api/banque-ao/attestations/${attestationId}/retrait`, c),
      { succes: "Pièce retirée.", messageSpecifique: messageBanqueAo },
    );
  }

  return (
    <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={soumettre}>
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      <Champ
        libelle="Motif du retrait"
        required
        maxLength={500}
        value={motif}
        onChange={(e) => setMotif(e.target.value)}
        erreur={f.erreurs.motif}
      />
      <div className="mp-actions-formulaire">
        <Bouton type="submit" variante="danger" chargement={f.enCours}>
          Retirer la pièce
        </Bouton>
      </div>
    </form>
  );
}
