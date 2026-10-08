"use client";

import { useRef, useState, type FormEvent } from "react";
import { api, messageErreur } from "../../lib/api";
import {
  construireContexte,
  messageMethodes,
  type Facteur,
  type SaisieContexte,
  type Simulation,
} from "../../lib/methodes";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import { Carte } from "../ui/Carte";
import { ChampsContexte } from "./ChampsContexte";
import { JournalModulation, VueDifferentiel } from "./ResultatModulation";

/**
 * Simulateur de modulation (STD-05) : le même jeu de règles appliqué à deux contextes ; le
 * différentiel (effets ajoutés, retirés, modifiés ; règles déclenchées ou éteintes) vient du
 * moteur, par l'API. Rien n'est enregistré.
 */
export function Simulateur({ versionId, facteurs }: { versionId: string; facteurs: Facteur[] }) {
  const [avant, setAvant] = useState<SaisieContexte>({});
  const [apres, setApres] = useState<SaisieContexte>({});
  const [erreursAvant, setErreursAvant] = useState<Partial<Record<string, string>>>({});
  const [erreursApres, setErreursApres] = useState<Partial<Record<string, string>>>({});
  const [resultat, setResultat] = useState<Simulation | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const refResultat = useRef<HTMLDivElement>(null);

  async function simuler(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErreur(null);
    const a = construireContexte(avant, facteurs);
    const b = construireContexte(apres, facteurs);
    setErreursAvant(a.ok ? {} : a.erreurs);
    setErreursApres(b.ok ? {} : b.erreurs);
    if (!a.ok || !b.ok) return;
    setEnCours(true);
    try {
      const r = await api.post<Simulation>(`/api/methodes/versions/${versionId}/simulation`, {
        contexte_avant: a.charge,
        contexte_apres: b.charge,
      });
      setResultat(r);
      setTimeout(() => refResultat.current?.focus(), 0);
    } catch (err) {
      setErreur(messageMethodes(err) ?? messageErreur(err));
    } finally {
      setEnCours(false);
    }
  }

  return (
    <form className="mp-pile" noValidate onSubmit={simuler}>
      <div className="mp-grille-cartes">
        <Carte titre="Contexte A">
          <ChampsContexte
            prefixe="a"
            facteurs={facteurs}
            valeur={avant}
            onChange={setAvant}
            erreurs={erreursAvant}
          />
        </Carte>
        <Carte titre="Contexte B">
          <ChampsContexte
            prefixe="b"
            facteurs={facteurs}
            valeur={apres}
            onChange={setApres}
            erreurs={erreursApres}
          />
        </Carte>
      </div>
      <div className="mp-actions-formulaire">
        <Bouton type="submit" icone="courbe" chargement={enCours} texteChargement="Simulation…">
          Comparer les deux contextes
        </Bouton>
      </div>
      {erreur ? (
        <Alerte tonalite="danger" titre="Simulation impossible">
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      {resultat ? (
        <div ref={refResultat} tabIndex={-1} className="mp-pile" aria-live="polite">
          <Carte titre="Différentiel de A à B">
            <VueDifferentiel d={resultat.differentiel} />
          </Carte>
          <div className="mp-grille-cartes">
            <Carte titre="Journal du contexte A">
              <JournalModulation r={resultat.avant} />
            </Carte>
            <Carte titre="Journal du contexte B">
              <JournalModulation r={resultat.apres} />
            </Carte>
          </div>
        </div>
      ) : null}
    </form>
  );
}
