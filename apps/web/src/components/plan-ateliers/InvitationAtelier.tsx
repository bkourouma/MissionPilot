"use client";

import { useState, type FormEvent } from "react";
import { api } from "../../lib/api";
import {
  cheminCandidats,
  cheminParticipants,
  messageAtelier,
  type Candidats,
} from "../../lib/plan-ateliers";
import type { Resultat } from "../../lib/saisie";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Bouton } from "../ui/Bouton";
import { Select } from "../ui/Select";

export interface InvitationAtelierProps {
  planId: string;
  atelierId: string;
  /** Faux : seuls les membres du cabinet sont proposés (inviter un dirigeant exige « portail.gerer »). */
  peutInviterClient: boolean;
}

/**
 * Invitation d'un participant : membre du cabinet ayant accès à la mission, ou dirigeant du client
 * (portail fermé par défaut : il ne voit que les ateliers où il est invité, une fois ouverts).
 */
export function InvitationAtelier({
  planId,
  atelierId,
  peutInviterClient,
}: InvitationAtelierProps) {
  const f = useFormulaire<"utilisateur_id">();
  const [ouvert, setOuvert] = useState(false);
  const [candidats, setCandidats] = useState<Candidats | null>(null);
  const [chargement, setChargement] = useState(false);
  const [choix, setChoix] = useState("");
  const [erreurChargement, setErreurChargement] = useState<string | null>(null);

  async function ouvrir() {
    setOuvert(true);
    setChargement(true);
    setErreurChargement(null);
    try {
      setCandidats(await api.get<Candidats>(cheminCandidats(planId, atelierId)));
    } catch (e) {
      setErreurChargement(messageAtelier(e));
    } finally {
      setChargement(false);
    }
  }

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const validation: Resultat<{ utilisateur_id: string }, "utilisateur_id"> = choix
      ? { ok: true, charge: { utilisateur_id: choix } }
      : { ok: false, erreurs: { utilisateur_id: "Choisissez une personne." } };
    const ok = await f.envoyer(
      validation,
      (corps) => api.post(cheminParticipants(planId, atelierId), corps),
      { succes: "Participant invité.", messageSpecifique: messageAtelier },
    );
    if (ok) {
      setChoix("");
      setOuvert(false);
    }
  }

  if (!ouvert) {
    return (
      <div className="mp-pile">
        <RetourFormulaire erreur={null} succes={f.succes} refAlerte={f.refAlerte} />
        <div>
          <Bouton variante="secondaire" icone="plus" onClick={ouvrir}>
            Inviter un participant
          </Bouton>
        </div>
      </div>
    );
  }
  const options = [
    ...(candidats?.cabinet ?? []).map((c) => ({ valeur: c.id, libelle: `${c.nom} (cabinet)` })),
    ...(peutInviterClient ? (candidats?.dirigeants ?? []) : []).map((c) => ({
      valeur: c.id,
      libelle: `${c.nom} (dirigeant du client)`,
    })),
  ];
  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire mp-sous-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label="Inviter un participant"
    >
      <RetourFormulaire
        erreur={f.erreurGlobale ?? erreurChargement}
        refAlerte={f.refAlerte}
        titreErreur="Invitation impossible"
      />
      <Select
        libelle="Participant"
        required
        invite={chargement ? "Chargement…" : "Choisir"}
        options={options}
        aide={
          candidats?.tronque
            ? "La liste est incomplète : seuls les premiers candidats par ordre alphabétique sont proposés."
            : undefined
        }
        value={choix}
        onChange={(e) => setChoix(e.target.value)}
        erreur={f.erreurs.utilisateur_id}
      />
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement="Invitation…">
          Inviter
        </Bouton>
        <Bouton variante="secondaire" disabled={f.enCours} onClick={() => setOuvert(false)}>
          Annuler
        </Bouton>
      </div>
    </form>
  );
}
