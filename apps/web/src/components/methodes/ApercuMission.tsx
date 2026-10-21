"use client";

import { useRef, useState, type FormEvent } from "react";
import { api, messageErreur } from "../../lib/api";
import { messageMethodes, type Facteur, type SaisieContexte } from "../../lib/methodes";
import {
  construireCorpsApercu,
  MENTION_APERCU,
  type ApercuMission as Apercu,
} from "../../lib/methodes-apercu";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import { Carte } from "../ui/Carte";
import { ChampsContexte } from "./ChampsContexte";
import { VueApercu } from "./VueApercu";

/**
 * Aperçu de la mission que générerait cette version pour un contexte donné (STD-11) : mêmes
 * règles et même résolution que la méthode d'une vraie mission, sans rien écrire.
 */
export function ApercuMission({ versionId, facteurs }: { versionId: string; facteurs: Facteur[] }) {
  const [contexte, setContexte] = useState<SaisieContexte>({});
  const [erreursChamps, setErreursChamps] = useState<Partial<Record<string, string>>>({});
  const [apercu, setApercu] = useState<Apercu | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const refResultat = useRef<HTMLDivElement>(null);
  const refErreur = useRef<HTMLDivElement>(null);

  async function generer(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErreur(null);
    const corps = construireCorpsApercu(contexte, facteurs);
    setErreursChamps(corps.ok ? {} : corps.erreurs);
    if (!corps.ok) return;
    setEnCours(true);
    try {
      const r = await api.post<Apercu>(`/api/methodes/versions/${versionId}/apercu`, corps.charge);
      setApercu(r);
      setTimeout(() => refResultat.current?.focus(), 0);
    } catch (err) {
      setApercu(null);
      setErreur(messageMethodes(err) ?? messageErreur(err));
      setTimeout(() => refErreur.current?.focus(), 0);
    } finally {
      setEnCours(false);
    }
  }

  return (
    <div className="mp-pile">
      <Alerte tonalite="info" annonce="aucune">
        <p>{MENTION_APERCU}</p>
      </Alerte>
      <form className="mp-pile" noValidate onSubmit={generer}>
        <Carte titre="Contexte de la mission type">
          <p className="mp-texte-doux">
            Renseignez ce que vous savez du client : un champ laissé vide est « non renseigné », et
            une règle ne se déclenche jamais sur une donnée inconnue.
          </p>
          <ChampsContexte
            prefixe="apercu"
            facteurs={facteurs}
            valeur={contexte}
            onChange={setContexte}
            erreurs={erreursChamps}
          />
        </Carte>
        <div className="mp-actions-formulaire">
          <Bouton type="submit" icone="courbe" chargement={enCours} texteChargement="Génération…">
            Générer l&apos;aperçu
          </Bouton>
        </div>
      </form>
      {erreur ? (
        <Alerte ref={refErreur} tonalite="danger" titre="Aperçu impossible">
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      {apercu ? (
        <div ref={refResultat} tabIndex={-1} className="mp-pile" aria-live="polite">
          <Alerte tonalite="info" annonce="aucune">
            <p>{MENTION_APERCU}</p>
          </Alerte>
          <VueApercu a={apercu} />
        </div>
      ) : null}
    </div>
  );
}
