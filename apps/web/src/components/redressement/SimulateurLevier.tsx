"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import type { RedDefinitionLevierVue, RedImpactLevierVue } from "@missionpilot/shared";
import { api, ErreurApi } from "../../lib/api";
import { formaterMontantMineur, type Devise } from "../../lib/format";
import {
  cheminSimulationLevier,
  hrefRedressement,
  messageRedressement,
  TEXTE_LEVIERS,
} from "../../lib/redressement";
import { corpsSimulationDepuisFormulaire } from "../../lib/redressement-saisie";
import { aideMontant } from "../../lib/saisie";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";
import { ImpactLevier } from "./ImpactLevier";

const UNITES: Record<RedDefinitionLevierVue["parametres"][number]["unite"], string> = {
  jours: "jours",
  pb: "points de base (100 = 1 %)",
  mois: "mois",
  montant: "montant",
};

/** Un champ par paramètre du levier, avec son unité et ses bornes (celles du moteur). */
export function ChampsParametresLevier({
  definition,
  valeurs,
  onChange,
  devise,
}: {
  definition: RedDefinitionLevierVue;
  valeurs: Readonly<Record<string, string>>;
  onChange: (cle: string, valeur: string) => void;
  devise: Devise;
}) {
  return (
    <div className="mp-grille-champs">
      {definition.parametres.map((p) => (
        <Champ
          key={p.cle}
          libelle={p.libelle}
          required
          inputMode="decimal"
          autoComplete="off"
          value={valeurs[p.cle] ?? ""}
          onChange={(e) => onChange(p.cle, e.target.value)}
          aide={
            p.unite === "montant"
              ? `${aideMontant(devise)} Borne indicative du moteur : de ${formaterMontantMineur(p.min, devise)} à ${formaterMontantMineur(p.max, devise)}.`
              : `En ${UNITES[p.unite]}, de ${p.min} à ${p.max}.`
          }
        />
      ))}
    </div>
  );
}

/**
 * Simulateur de levier (RED-14) : levier, paramètres, « Simuler ». L'impact est calculé par le
 * moteur à partir du dernier état accepté ; la simulation n'écrit rien. Quand la base est
 * incomplète, l'erreur nomme les postes manquants et renvoie vers l'onglet « Ratios ».
 */
export function SimulateurLevier({
  missionId,
  dossierId,
  devise,
  leviers,
  codeInitial,
}: {
  missionId: string;
  dossierId: string;
  devise: Devise;
  leviers: RedDefinitionLevierVue[];
  codeInitial?: string;
}) {
  const [code, setCode] = useState(codeInitial ?? leviers[0]?.code ?? "");
  const [valeurs, setValeurs] = useState<Record<string, string>>({});
  const [impact, setImpact] = useState<RedImpactLevierVue | null>(null);
  const [erreur, setErreur] = useState<{ message: string; baseIncomplete: boolean } | null>(null);
  const [erreurChamps, setErreurChamps] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const definition = leviers.find((l) => l.code === code);

  async function simuler(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErreur(null);
    setErreurChamps(null);
    const v = corpsSimulationDepuisFormulaire(definition, valeurs, devise);
    if (!v.ok) {
      setErreurChamps(v.erreurs.levier ?? v.erreurs.parametres ?? "Saisie invalide.");
      return;
    }
    setEnCours(true);
    try {
      setImpact(await api.post<RedImpactLevierVue>(cheminSimulationLevier(dossierId), v.charge));
    } catch (err) {
      setImpact(null);
      setErreur({
        message: messageRedressement(err),
        baseIncomplete: err instanceof ErreurApi && err.code === "RED_BASE_INCOMPLETE",
      });
    } finally {
      setEnCours(false);
    }
  }

  return (
    <div className="mp-red-section">
      <form className="mp-formulaire" noValidate onSubmit={simuler} aria-label="Simuler un levier">
        <Select
          libelle="Levier"
          value={code}
          onChange={(e) => {
            setCode(e.target.value);
            setValeurs({});
            setImpact(null);
            setErreur(null);
          }}
          options={leviers.map((l) => ({ valeur: l.code, libelle: l.libelle }))}
        />
        {definition ? (
          <ChampsParametresLevier
            definition={definition}
            valeurs={valeurs}
            onChange={(cle, valeur) => setValeurs((x) => ({ ...x, [cle]: valeur }))}
            devise={devise}
          />
        ) : null}
        {erreurChamps ? (
          <Alerte tonalite="danger" annonce="alert">
            <p>{erreurChamps}</p>
          </Alerte>
        ) : null}
        <div className="mp-actions-formulaire">
          <Bouton type="submit" chargement={enCours} texteChargement="Simulation…">
            Simuler
          </Bouton>
        </div>
      </form>
      {erreur ? (
        <Alerte tonalite="danger" titre="Simulation impossible" annonce="alert">
          <p>{erreur.message}</p>
          {erreur.baseIncomplete ? (
            <p>
              <Link href={hrefRedressement(missionId, "ratios")}>
                Compléter la correspondance dans l&apos;onglet « Ratios »
              </Link>
            </p>
          ) : null}
        </Alerte>
      ) : null}
      {impact ? (
        <div className="mp-red-section" aria-live="polite">
          <ImpactLevier impact={impact} />
          <p className="mp-texte-doux">{TEXTE_LEVIERS}</p>
        </div>
      ) : null}
    </div>
  );
}
