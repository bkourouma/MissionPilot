"use client";

import { useState, type FormEvent } from "react";
import {
  NATURES_DEROGATION,
  type EtapeGardeDerogation,
  type NatureDerogation,
} from "@missionpilot/shared";
import { api } from "../../lib/api";
import { libelleEtapeGarde, libelleNature, messageMethodes } from "../../lib/methodes";
import type { Resultat } from "../../lib/saisie";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Bouton } from "../ui/Bouton";
import { Select } from "../ui/Select";
import { ZoneTexte } from "../ui/ZoneTexte";

type ChampDerogation = "brique_code" | "description" | "motif";

/** Demande de dérogation motivée (STD-07) ; l'approbation suit la classe de risque de la brique. */
export function FormulaireDerogation({
  missionId,
  briques,
}: {
  missionId: string;
  briques: { code: string; libelle: string; active: boolean; classe_risque: string }[];
}) {
  const f = useFormulaire<ChampDerogation>();
  const [briqueCode, setBriqueCode] = useState("");
  const [nature, setNature] = useState<NatureDerogation>("retirer_brique");
  const [description, setDescription] = useState("");
  const [motif, setMotif] = useState("");

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const erreurs: Partial<Record<ChampDerogation, string>> = {};
    if (!briqueCode) erreurs.brique_code = "Choisir la brique.";
    if (motif.trim().length < 10) erreurs.motif = "Motif de 10 caractères au moins.";
    if (nature === "adapter_brique" && !description.trim())
      erreurs.description = "Décrire l'adaptation.";
    const charge = {
      brique_code: briqueCode,
      nature,
      description: description.trim() || null,
      motif: motif.trim(),
    };
    const validation: Resultat<typeof charge, ChampDerogation> =
      Object.keys(erreurs).length > 0 ? { ok: false, erreurs } : { ok: true, charge };
    const ok = await f.envoyer(
      validation,
      (c) => api.post(`/api/missions/${missionId}/derogations`, c),
      {
        succes: "Dérogation demandée.",
        messageSpecifique: messageMethodes,
      },
    );
    if (ok) {
      setMotif("");
      setDescription("");
    }
  }

  return (
    <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={soumettre}>
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur="Demande impossible"
      />
      <div className="mp-grille-champs">
        <Select
          libelle="Brique"
          required
          value={briqueCode}
          onChange={(e) => setBriqueCode(e.target.value)}
          invite="Choisir…"
          options={briques.map((b) => ({
            valeur: b.code,
            libelle: `${b.libelle} (${b.classe_risque}${b.active ? "" : ", inactive"})`,
          }))}
          erreur={f.erreurs.brique_code}
        />
        <Select
          libelle="Nature"
          value={nature}
          onChange={(e) => setNature(e.target.value as NatureDerogation)}
          options={NATURES_DEROGATION.map((n) => ({ valeur: n, libelle: libelleNature(n) }))}
        />
      </div>
      {nature === "adapter_brique" ? (
        <ZoneTexte
          libelle="Adaptation demandée"
          required
          rows={2}
          maxLength={2000}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          erreur={f.erreurs.description}
        />
      ) : null}
      <ZoneTexte
        libelle="Motif"
        required
        rows={3}
        maxLength={2000}
        value={motif}
        onChange={(e) => setMotif(e.target.value)}
        erreur={f.erreurs.motif}
        aide="Obligatoire : il sera relu par les approbateurs et analysé par le comité méthode."
      />
      <div className="mp-actions-formulaire">
        <Bouton type="submit" icone="drapeau" chargement={f.enCours} texteChargement="Envoi…">
          Demander la dérogation
        </Bouton>
      </div>
    </form>
  );
}

/** Décision sur la prochaine étape de la garde (approuver, ou refuser avec motif). */
export function DecisionDerogation({
  derogationId,
  etape,
}: {
  derogationId: string;
  etape: EtapeGardeDerogation;
}) {
  const f = useFormulaire<"commentaire">();
  const [commentaire, setCommentaire] = useState("");

  async function decider(decision: "approuve" | "refuse") {
    const validation: Resultat<
      { etape: string; decision: string; commentaire: string | null },
      "commentaire"
    > =
      decision === "refuse" && !commentaire.trim()
        ? { ok: false, erreurs: { commentaire: "Motiver le refus." } }
        : { ok: true, charge: { etape, decision, commentaire: commentaire.trim() || null } };
    await f.envoyer(validation, (c) => api.post(`/api/derogations/${derogationId}/decisions`, c), {
      succes: decision === "approuve" ? "Étape approuvée." : "Dérogation refusée.",
      messageSpecifique: messageMethodes,
    });
  }

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
        libelle={`Commentaire — ${libelleEtapeGarde(etape)}`}
        rows={2}
        maxLength={2000}
        value={commentaire}
        onChange={(e) => setCommentaire(e.target.value)}
        erreur={f.erreurs.commentaire}
      />
      <div className="mp-actions-formulaire">
        <Bouton
          type="button"
          icone="succes"
          chargement={f.enCours}
          onClick={() => void decider("approuve")}
        >
          Approuver
        </Bouton>
        <Bouton
          type="button"
          variante="danger"
          disabled={f.enCours}
          onClick={() => void decider("refuse")}
        >
          Refuser
        </Bouton>
      </div>
    </form>
  );
}
