"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { DECISIONS_ARBITRAGE } from "@missionpilot/shared";
import { api } from "../../lib/api";
import {
  cheminArbitragesAssertion,
  cheminDimension,
  cheminDimensions,
  cheminLienAssertion,
  cheminLiensAssertion,
  DECISIONS,
  etatPreuvesChange,
  messagePreuves,
  SENS_LIBELLES,
  TYPE_SOURCE_LIBELLES,
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
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";
import { ZoneTexte } from "../ui/ZoneTexte";

const OPTIONS_SENS = (["pour", "contre"] as const).map((s) => ({
  valeur: s,
  libelle:
    s === "pour" ? "Va dans le sens de l'assertion (pour)" : "Contredit l'assertion (contre)",
}));

export interface FormulaireLierProps {
  assertionId: string;
  /** Preuves de la mission pas encore liées à cette assertion. */
  candidates: readonly PreuveVue[];
}

/** Lier une preuve du registre à l'assertion, pour ou contre. Un lien contre ouvre une contradiction. */
export function FormulaireLier({ assertionId, candidates }: FormulaireLierProps) {
  const f = useFormulaire<ChampLien>();
  const [s, setS] = useState<SaisieLien>({ preuve_id: "", sens: "pour" });

  if (candidates.length === 0) {
    return (
      <p className="mp-texte-doux">
        Toutes les preuves de la mission sont déjà liées à cette assertion, ou le registre est vide.
      </p>
    );
  }

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const ok = await f.envoyer(
      validerLien(s),
      (charge) => api.post(cheminLiensAssertion(assertionId), charge),
      { succes: "Preuve liée : l'indice a été recalculé.", messageSpecifique: messagePreuves },
    );
    if (ok) setS((x) => ({ ...x, preuve_id: "" }));
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label="Lier une preuve"
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur="Lien refusé"
      />
      <div className="mp-grille-champs">
        <Select
          libelle="Preuve"
          required
          invite="Choisir…"
          options={candidates.map((p) => ({
            valeur: p.id,
            libelle:
              `${TYPE_SOURCE_LIBELLES[p.type_source]} · ${p.fiabilite} · ${p.source_precise}`.slice(
                0,
                120,
              ),
          }))}
          value={s.preuve_id}
          onChange={(e) => setS((x) => ({ ...x, preuve_id: e.target.value }))}
          erreur={f.erreurs.preuve_id}
        />
        <Select
          libelle="Sens"
          required
          options={OPTIONS_SENS}
          value={s.sens}
          onChange={(e) => setS((x) => ({ ...x, sens: e.target.value }))}
          erreur={f.erreurs.sens}
        />
      </div>
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement="Liaison…">
          Lier la preuve
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
  const router = useRouter();
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  async function delier() {
    setEnCours(true);
    setErreur(null);
    try {
      await api.supprimer(cheminLienAssertion(assertionId, preuveId));
      router.refresh();
    } catch (e) {
      setErreur(messagePreuves(e));
      if (etatPreuvesChange(e)) router.refresh();
    } finally {
      setEnCours(false);
    }
  }

  return (
    <div className="mp-pile">
      <Bouton variante="discret" chargement={enCours} texteChargement="Retrait…" onClick={delier}>
        {`Retirer le lien « ${SENS_LIBELLES[sens].toLowerCase()} »`}
      </Bouton>
      {erreur ? (
        <Alerte tonalite="danger" annonce="alert">
          <p>{erreur}</p>
        </Alerte>
      ) : null}
    </div>
  );
}

const OPTIONS_DECISION = DECISIONS_ARBITRAGE.map((d) => ({ valeur: d, libelle: DECISIONS[d] }));

export interface FormulaireArbitrageProps {
  assertionId: string;
  preuveId: string;
}

/** Arbitrage d'une contradiction par le consultant : décision et motif, conservés avec son nom. */
export function FormulaireArbitrage({ assertionId, preuveId }: FormulaireArbitrageProps) {
  const f = useFormulaire<ChampArbitrage>();
  const [s, setS] = useState<SaisieArbitrage>({ decision: "", motif: "" });

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await f.envoyer(
      validerArbitrage(s, preuveId),
      (charge) => api.post(cheminArbitragesAssertion(assertionId), charge),
      {
        succes: "Contradiction arbitrée : l'indice a été recalculé.",
        messageSpecifique: messagePreuves,
      },
    );
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label="Arbitrer la contradiction"
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur="Arbitrage refusé"
      />
      <Select
        libelle="Votre décision"
        required
        invite="Choisir…"
        options={OPTIONS_DECISION}
        value={s.decision}
        onChange={(e) => setS((x) => ({ ...x, decision: e.target.value }))}
        erreur={f.erreurs.decision}
      />
      <ZoneTexte
        libelle="Motif"
        required
        rows={2}
        maxLength={ARBITRAGE_MOTIF_MAX}
        value={s.motif}
        onChange={(e) => setS((x) => ({ ...x, motif: e.target.value }))}
        erreur={f.erreurs.motif}
        aide="Conservé avec votre nom et la date. Corriger la preuve plus tard rouvre la contradiction."
      />
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement="Enregistrement…">
          Enregistrer l&apos;arbitrage
        </Bouton>
      </div>
    </form>
  );
}

/** Déclarer une dimension (axe d'analyse) de la mission : base de la carte de triangulation. */
export function FormulaireDimension({ missionId }: { missionId: string }) {
  const f = useFormulaire<ChampDimension>();
  const [s, setS] = useState<SaisieDimension>({ libelle: "", code: "" });

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const ok = await f.envoyer(
      validerDimension(s),
      (charge) => api.post(cheminDimensions(missionId), charge),
      { succes: "Dimension ajoutée.", messageSpecifique: messagePreuves },
    );
    if (ok) setS({ libelle: "", code: "" });
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label="Nouvelle dimension"
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur="Dimension refusée"
      />
      <Champ
        libelle="Dimension"
        required
        maxLength={LIBELLE_DIMENSION_MAX}
        value={s.libelle}
        onChange={(e) => setS((x) => ({ ...x, libelle: e.target.value }))}
        erreur={f.erreurs.libelle}
        aide="Un axe d'analyse de la mission : gouvernance, finance, ressources humaines…"
      />
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement="Ajout…">
          Ajouter la dimension
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
  const router = useRouter();
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  async function basculer() {
    setEnCours(true);
    setErreur(null);
    try {
      await api.patch(cheminDimension(missionId, dimension.id), { actif: !dimension.actif });
      router.refresh();
    } catch (e) {
      setErreur(messagePreuves(e));
    } finally {
      setEnCours(false);
    }
  }

  return (
    <div className="mp-pile">
      <Bouton variante="discret" chargement={enCours} texteChargement="…" onClick={basculer}>
        {dimension.actif ? "Désactiver" : "Réactiver"}
      </Bouton>
      {erreur ? <p className="mp-champ__erreur">{erreur}</p> : null}
    </div>
  );
}
