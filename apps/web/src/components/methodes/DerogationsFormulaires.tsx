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
import { useLangue, useT } from "../i18n/FournisseurLangue";
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
  const t = useT();
  const langue = useLangue();
  const f = useFormulaire<ChampDerogation>();
  const [briqueCode, setBriqueCode] = useState("");
  const [nature, setNature] = useState<NatureDerogation>("retirer_brique");
  const [description, setDescription] = useState("");
  const [motif, setMotif] = useState("");

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const erreurs: Partial<Record<ChampDerogation, string>> = {};
    if (!briqueCode) erreurs.brique_code = t("Choisir la brique.", "Choose the building block.");
    if (motif.trim().length < 10) {
      erreurs.motif = t("Motif de 10 caractères au moins.", "Reason of at least 10 characters.");
    }
    if (nature === "adapter_brique" && !description.trim()) {
      erreurs.description = t("Décrire l'adaptation.", "Describe the adaptation.");
    }
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
        succes: t("Dérogation demandée.", "Waiver requested."),
        messageSpecifique: (e) => messageMethodes(e, langue),
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
        titreErreur={t("Demande impossible", "Request not possible")}
      />
      <div className="mp-grille-champs">
        <Select
          libelle={t("Brique", "Building block")}
          required
          value={briqueCode}
          onChange={(e) => setBriqueCode(e.target.value)}
          invite={t("Choisir…", "Choose…")}
          options={briques.map((b) => ({
            valeur: b.code,
            libelle: `${b.libelle} (${b.classe_risque}${b.active ? "" : t(", inactive", ", inactive")})`,
          }))}
          erreur={f.erreurs.brique_code}
        />
        <Select
          libelle={t("Nature", "Type")}
          value={nature}
          onChange={(e) => setNature(e.target.value as NatureDerogation)}
          options={NATURES_DEROGATION.map((n) => ({
            valeur: n,
            libelle: libelleNature(n, langue),
          }))}
        />
      </div>
      {nature === "adapter_brique" ? (
        <ZoneTexte
          libelle={t("Adaptation demandée", "Requested adaptation")}
          required
          rows={2}
          maxLength={2000}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          erreur={f.erreurs.description}
        />
      ) : null}
      <ZoneTexte
        libelle={t("Motif", "Reason")}
        required
        rows={3}
        maxLength={2000}
        value={motif}
        onChange={(e) => setMotif(e.target.value)}
        erreur={f.erreurs.motif}
        aide={t(
          "Obligatoire : il sera relu par les approbateurs et analysé par le comité méthode.",
          "Required: it will be read by the approvers and analyzed by the method committee.",
        )}
      />
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          icone="drapeau"
          chargement={f.enCours}
          texteChargement={t("Envoi…", "Sending…")}
        >
          {t("Demander la dérogation", "Request the waiver")}
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
  const t = useT();
  const langue = useLangue();
  const f = useFormulaire<"commentaire">();
  const [commentaire, setCommentaire] = useState("");
  // Bouton à l'origine de l'envoi : l'indicateur « en cours » s'affiche sur lui seul.
  const [choix, setChoix] = useState<"approuve" | "refuse" | null>(null);

  async function decider(decision: "approuve" | "refuse") {
    setChoix(decision);
    const validation: Resultat<
      { etape: string; decision: string; commentaire: string | null },
      "commentaire"
    > =
      decision === "refuse" && !commentaire.trim()
        ? {
            ok: false,
            erreurs: { commentaire: t("Motiver le refus.", "Give a reason for the refusal.") },
          }
        : { ok: true, charge: { etape, decision, commentaire: commentaire.trim() || null } };
    await f.envoyer(validation, (c) => api.post(`/api/derogations/${derogationId}/decisions`, c), {
      succes:
        decision === "approuve"
          ? t("Étape approuvée.", "Step approved.")
          : t("Dérogation refusée.", "Waiver refused."),
      messageSpecifique: (e) => messageMethodes(e, langue),
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
        titreErreur={t("Décision impossible", "Decision not possible")}
      />
      <ZoneTexte
        libelle={`${t("Commentaire", "Comment")} — ${libelleEtapeGarde(etape, langue)}`}
        rows={2}
        maxLength={2000}
        value={commentaire}
        onChange={(e) => setCommentaire(e.target.value)}
        erreur={f.erreurs.commentaire}
        aide={t(
          "Facultatif pour approuver ; obligatoire pour refuser.",
          "Optional to approve; required to refuse.",
        )}
      />
      <div className="mp-actions-formulaire">
        <Bouton
          type="button"
          icone="succes"
          chargement={f.enCours && choix === "approuve"}
          texteChargement={t("Enregistrement…", "Saving…")}
          disabled={f.enCours}
          onClick={() => void decider("approuve")}
        >
          {t("Approuver", "Approve")}
        </Bouton>
        <Bouton
          type="button"
          variante="danger"
          chargement={f.enCours && choix === "refuse"}
          texteChargement={t("Enregistrement…", "Saving…")}
          disabled={f.enCours}
          onClick={() => void decider("refuse")}
        >
          {t("Refuser", "Refuse")}
        </Bouton>
      </div>
    </form>
  );
}
