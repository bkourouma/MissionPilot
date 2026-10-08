"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import { formaterDateHeure } from "../../lib/format";
import { cheminPartage, etatPlanChange, messagePlan } from "../../lib/plan-strategique";
import { BoutonConfirmation } from "../formulaires/BoutonConfirmation";
import { useAttenteRafraichissement } from "../formulaires/useAttenteRafraichissement";
import { Alerte } from "../ui/Alerte";

export interface PartagePlanProps {
  planId: string;
  partage: boolean;
  partageLe: string | null;
  /** Ce qui empêche le partage (`manquesPartage`), vide si rien ne manque. */
  manques: string[];
  /** Responsable de la mission avec le droit de gérer le portail (confort d'affichage). */
  peutPartager: boolean;
  /** Pourquoi l'utilisateur ne peut pas partager (null s'il le peut). */
  raisonSansDroit: string | null;
}

/**
 * Partage du plan au client (SOC-06) : rien n'est partagé par défaut ; le partage exige que
 * TOUT le contenu soit validé (et la dernière version du modèle financier) — l'écran dit ce
 * qui manque. Le retrait est possible à tout moment. L'API reste seule juge (409 sinon).
 */
export function PartagePlan({
  planId,
  partage,
  partageLe,
  manques,
  peutPartager,
  raisonSansDroit,
}: PartagePlanProps) {
  const router = useRouter();
  const [erreur, setErreur] = useState<string | null>(null);
  const [succes, setSucces] = useState<string | null>(null);
  const [attente, attendre] = useAttenteRafraichissement(partage);
  const refErreur = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (erreur) refErreur.current?.focus();
  }, [erreur]);

  async function basculer(partager: boolean): Promise<boolean> {
    if (attente) return false;
    setErreur(null);
    setSucces(null);
    try {
      await api.post(cheminPartage(planId), { partage_client: partager });
      setSucces(
        partager
          ? "Plan partagé au client : sa diffusion au client est désormais autorisée."
          : "Partage retiré : le plan n'est plus diffusable au client.",
      );
      attendre();
      router.refresh();
      return true;
    } catch (e) {
      setErreur(messagePlan(e, "partager"));
      if (etatPlanChange(e)) router.refresh();
      return false;
    }
  }

  return (
    <div className="mp-plan__section">
      {erreur ? (
        <Alerte ref={refErreur} tonalite="danger" titre="Partage refusé">
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      {succes ? (
        <Alerte tonalite="succes" annonce="status">
          <p>{succes}</p>
        </Alerte>
      ) : null}

      {partage ? (
        <Alerte tonalite="succes" titre="Plan partagé au client" annonce="aucune">
          <p>
            {partageLe ? `Partagé le ${formaterDateHeure(partageLe)}. ` : ""}
            Le partage autorise la diffusion au client du contenu validé et du modèle financier
            validé de ce plan.
          </p>
        </Alerte>
      ) : manques.length > 0 ? (
        <Alerte tonalite="info" titre="Partage impossible pour l'instant" annonce="aucune">
          <p>
            Rien n&apos;est partagé au client par défaut. Avant tout partage, chaque contenu doit
            être validé par un responsable de la mission. Il manque :
          </p>
          <ul className="mp-plan__liste-manques">
            {manques.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </Alerte>
      ) : (
        <Alerte tonalite="info" titre="Prêt pour le client" annonce="aucune">
          <p>
            Tout le contenu est validé : le plan peut être partagé au client. Rien n&apos;est
            partagé tant qu&apos;un responsable ne l&apos;a pas décidé.
          </p>
        </Alerte>
      )}

      {peutPartager && partage ? (
        <div className="mp-barre-actions">
          <BoutonConfirmation
            libelle="Retirer le partage"
            question="Retirer le partage ? Le plan ne sera plus diffusable au client."
            libelleConfirmation="Oui, retirer"
            texteChargement="Retrait…"
            icone="cadenas"
            action={() => basculer(false)}
          />
        </div>
      ) : null}
      {peutPartager && !partage && manques.length === 0 ? (
        <div className="mp-barre-actions">
          <BoutonConfirmation
            libelle="Partager au client"
            question="Partager ce plan au client ? Le contenu validé et le modèle financier validé lui deviennent diffusables. Toute modification ultérieure retirera ce partage."
            libelleConfirmation="Oui, partager"
            texteChargement="Partage…"
            variante="primaire"
            icone="envoyer"
            action={() => basculer(true)}
          />
        </div>
      ) : null}
      {!peutPartager && raisonSansDroit ? (
        <p className="mp-texte-doux mp-texte-petit">{raisonSansDroit}</p>
      ) : null}
    </div>
  );
}
