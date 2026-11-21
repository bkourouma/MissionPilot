"use client";

import { useRafraichir } from "../formulaires/useRafraichir";
import { useState, type FormEvent } from "react";
import { DECISIONS_ARBITRAGE } from "@missionpilot/shared";
import { api } from "../../lib/api";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import {
  cheminArbitragesAssertion,
  cheminDimension,
  cheminDimensions,
  cheminLienAssertion,
  cheminLiensAssertion,
  etatPreuvesChange,
  libelleDecision,
  libelleSens,
  libelleTypeSourcePreuve,
  messagePreuves,
  type DimensionVue,
  type PreuveVue,
} from "../../lib/preuves";
import {
  ARBITRAGE_MOTIF_MAX,
  LIBELLE_DIMENSION_MAX,
  validerArbitrage,
  validerDimension,
  validerLien,
  type ChampArbitrage,
  type ChampDimension,
  type ChampLien,
  type SaisieArbitrage,
  type SaisieDimension,
  type SaisieLien,
} from "../../lib/preuves-saisie";
import { BoutonConfirmation } from "../formulaires/BoutonConfirmation";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";
import { ZoneTexte } from "../ui/ZoneTexte";

export interface FormulaireLierProps {
  assertionId: string;
  /** Preuves de la mission pas encore liées à cette assertion. */
  candidates: readonly PreuveVue[];
}

/** Lier une preuve du registre à l'assertion, pour ou contre. Un lien contre ouvre une contradiction. */
export function FormulaireLier({ assertionId, candidates }: FormulaireLierProps) {
  const t = useT();
  const langue = useLangue();
  const f = useFormulaire<ChampLien>();
  const [s, setS] = useState<SaisieLien>({ preuve_id: "", sens: "pour" });
  const optionsSens = (["pour", "contre"] as const).map((v) => ({
    valeur: v,
    libelle:
      v === "pour"
        ? t("Va dans le sens de l'assertion (pour)", "Supports the assertion (for)")
        : t("Contredit l'assertion (contre)", "Contradicts the assertion (against)"),
  }));

  if (candidates.length === 0) {
    return (
      <p className="mp-texte-doux">
        {t(
          "Toutes les preuves de la mission sont déjà liées à cette assertion, ou le registre est vide.",
          "All the engagement's evidence is already linked to this assertion, or the register is empty.",
        )}
      </p>
    );
  }

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const ok = await f.envoyer(
      validerLien(s, langue),
      (charge) => api.post(cheminLiensAssertion(assertionId), charge),
      {
        succes: t(
          "Preuve liée : l'indice a été recalculé.",
          "Evidence linked: the index was recomputed.",
        ),
        messageSpecifique: (e) => messagePreuves(e, langue),
      },
    );
    if (ok) setS((x) => ({ ...x, preuve_id: "" }));
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label={t("Lier une preuve", "Link evidence")}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={t("Lien refusé", "Link rejected")}
      />
      <div className="mp-grille-champs">
        <Select
          libelle={t("Preuve", "Evidence")}
          required
          invite={t("Choisir…", "Choose…")}
          options={candidates.map((p) => ({
            valeur: p.id,
            libelle:
              `${libelleTypeSourcePreuve(p.type_source, langue)} · ${p.fiabilite} · ${p.source_precise}`.slice(
                0,
                120,
              ),
          }))}
          value={s.preuve_id}
          onChange={(e) => setS((x) => ({ ...x, preuve_id: e.target.value }))}
          erreur={f.erreurs.preuve_id}
        />
        <Select
          libelle={t("Sens", "Direction")}
          required
          options={optionsSens}
          value={s.sens}
          onChange={(e) => setS((x) => ({ ...x, sens: e.target.value }))}
          erreur={f.erreurs.sens}
        />
      </div>
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement={t("Liaison…", "Linking…")}>
          {t("Lier la preuve", "Link the evidence")}
        </Bouton>
      </div>
    </form>
  );
}

export interface BoutonDelierProps {
  assertionId: string;
  preuveId: string;
  sens: "pour" | "contre";
}

/** Retirer le lien (l'événement est conservé dans le journal du registre). */
export function BoutonDelier({ assertionId, preuveId, sens }: BoutonDelierProps) {
  const t = useT();
  const langue = useLangue();
  const { rafraichir } = useRafraichir();
  const [erreur, setErreur] = useState<string | null>(null);

  /** `false` ramène le bouton à son état initial après un échec ; le message reste affiché. */
  async function delier(): Promise<boolean> {
    setErreur(null);
    try {
      await api.supprimer(cheminLienAssertion(assertionId, preuveId));
      rafraichir();
      return true;
    } catch (e) {
      setErreur(messagePreuves(e, langue));
      if (etatPreuvesChange(e)) rafraichir();
      return false;
    }
  }

  const libelleLien = libelleSens(sens, langue).toLowerCase();
  return (
    <div className="mp-pile">
      <BoutonConfirmation
        variante="discret"
        libelle={t(`Retirer le lien « ${libelleLien} »`, `Remove the "${libelleLien}" link`)}
        question={t(
          `Retirer le lien « ${libelleLien} » ? L'indice de l'assertion sera recalculé ; l'événement reste dans le journal du registre.`,
          `Remove the "${libelleLien}" link? The assertion index will be recomputed; the event stays in the register log.`,
        )}
        libelleConfirmation={t("Oui, retirer", "Yes, remove")}
        texteChargement={t("Retrait…", "Removing…")}
        action={delier}
      />
      {erreur ? (
        <Alerte tonalite="danger" annonce="alert">
          <p>{erreur}</p>
        </Alerte>
      ) : null}
    </div>
  );
}

export interface FormulaireArbitrageProps {
  assertionId: string;
  preuveId: string;
}

/** Arbitrage d'une contradiction par le consultant : décision et motif, conservés avec son nom. */
export function FormulaireArbitrage({ assertionId, preuveId }: FormulaireArbitrageProps) {
  const t = useT();
  const langue = useLangue();
  const optionsDecision = DECISIONS_ARBITRAGE.map((d) => ({
    valeur: d,
    libelle: libelleDecision(d, langue),
  }));
  const f = useFormulaire<ChampArbitrage>();
  const [s, setS] = useState<SaisieArbitrage>({ decision: "", motif: "" });

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await f.envoyer(
      validerArbitrage(s, preuveId, langue),
      (charge) => api.post(cheminArbitragesAssertion(assertionId), charge),
      {
        succes: t(
          "Contradiction arbitrée : l'indice a été recalculé.",
          "Contradiction arbitrated: the index was recomputed.",
        ),
        messageSpecifique: (e) => messagePreuves(e, langue),
      },
    );
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label={t("Arbitrer la contradiction", "Arbitrate the contradiction")}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={t("Arbitrage refusé", "Arbitration rejected")}
      />
      <Select
        libelle={t("Votre décision", "Your decision")}
        required
        invite={t("Choisir…", "Choose…")}
        options={optionsDecision}
        value={s.decision}
        onChange={(e) => setS((x) => ({ ...x, decision: e.target.value }))}
        erreur={f.erreurs.decision}
      />
      <ZoneTexte
        libelle={t("Motif", "Reason")}
        required
        rows={2}
        maxLength={ARBITRAGE_MOTIF_MAX}
        value={s.motif}
        onChange={(e) => setS((x) => ({ ...x, motif: e.target.value }))}
        erreur={f.erreurs.motif}
        aide={t(
          "Conservé avec votre nom et la date. Corriger la preuve plus tard rouvre la contradiction.",
          "Kept with your name and the date. Correcting the evidence later reopens the contradiction.",
        )}
      />
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          chargement={f.enCours}
          texteChargement={t("Enregistrement…", "Saving…")}
        >
          {t("Enregistrer l'arbitrage", "Save the arbitration")}
        </Bouton>
      </div>
    </form>
  );
}

/** Déclarer une dimension (axe d'analyse) de la mission : base de la carte de triangulation. */
export function FormulaireDimension({ missionId }: { missionId: string }) {
  const t = useT();
  const langue = useLangue();
  const f = useFormulaire<ChampDimension>();
  const [s, setS] = useState<SaisieDimension>({ libelle: "", code: "" });

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const ok = await f.envoyer(
      validerDimension(s, langue),
      (charge) => api.post(cheminDimensions(missionId), charge),
      {
        succes: t("Dimension ajoutée.", "Dimension added."),
        messageSpecifique: (e) => messagePreuves(e, langue),
      },
    );
    if (ok) setS({ libelle: "", code: "" });
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label={t("Nouvelle dimension", "New dimension")}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={t("Dimension refusée", "Dimension rejected")}
      />
      <Champ
        libelle={t("Dimension", "Dimension")}
        required
        maxLength={LIBELLE_DIMENSION_MAX}
        value={s.libelle}
        onChange={(e) => setS((x) => ({ ...x, libelle: e.target.value }))}
        erreur={f.erreurs.libelle}
        aide={t(
          "Un axe d'analyse de la mission : gouvernance, finance, ressources humaines…",
          "An analysis axis of the engagement: governance, finance, human resources…",
        )}
      />
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement={t("Ajout…", "Adding…")}>
          {t("Ajouter la dimension", "Add the dimension")}
        </Bouton>
      </div>
    </form>
  );
}

/** Désactiver ou réactiver une dimension (elle sort de la carte, ses preuves restent). */
export function BoutonActivationDimension({
  missionId,
  dimension,
}: {
  missionId: string;
  dimension: DimensionVue;
}) {
  const t = useT();
  const langue = useLangue();
  const { rafraichir } = useRafraichir();
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  async function basculer() {
    setEnCours(true);
    setErreur(null);
    try {
      await api.patch(cheminDimension(missionId, dimension.id), { actif: !dimension.actif });
      rafraichir();
    } catch (e) {
      setErreur(messagePreuves(e, langue));
    } finally {
      setEnCours(false);
    }
  }

  return (
    <div className="mp-pile">
      <Bouton
        variante="discret"
        chargement={enCours}
        texteChargement={
          dimension.actif
            ? t("Désactivation…", "Deactivating…")
            : t("Réactivation…", "Reactivating…")
        }
        aria-label={
          dimension.actif
            ? t(
                `Désactiver la dimension ${dimension.libelle}`,
                `Deactivate dimension ${dimension.libelle}`,
              )
            : t(
                `Réactiver la dimension ${dimension.libelle}`,
                `Reactivate dimension ${dimension.libelle}`,
              )
        }
        onClick={basculer}
      >
        {dimension.actif ? t("Désactiver", "Deactivate") : t("Réactiver", "Reactivate")}
      </Bouton>
      {erreur ? (
        <Alerte tonalite="danger" annonce="alert">
          <p>{erreur}</p>
        </Alerte>
      ) : null}
    </div>
  );
}
