"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import { formaterDateHeure } from "../../lib/format";
import { cheminPartage, etatPlanChange, messagePlan } from "../../lib/plan-strategique";
import { BoutonConfirmation } from "../formulaires/BoutonConfirmation";
import { useAttenteRafraichissement } from "../formulaires/useAttenteRafraichissement";
import { useRafraichir } from "../formulaires/useRafraichir";
import { useLangue, useT } from "../i18n/FournisseurLangue";
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
  const t = useT();
  const langue = useLangue();
  const { rafraichir } = useRafraichir();
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
          ? t(
              "Plan partagé au client : sa diffusion au client est désormais autorisée.",
              "Plan shared with the client: it may now be distributed to the client.",
            )
          : t(
              "Partage retiré : le plan n'est plus diffusable au client.",
              "Sharing withdrawn: the plan can no longer be distributed to the client.",
            ),
      );
      attendre();
      rafraichir();
      return true;
    } catch (e) {
      setErreur(messagePlan(e, "partager", langue));
      if (etatPlanChange(e)) rafraichir();
      return false;
    }
  }

  return (
    <div className="mp-plan__section">
      {erreur ? (
        <Alerte ref={refErreur} tonalite="danger" titre={t("Partage refusé", "Sharing refused")}>
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      {succes ? (
        <Alerte tonalite="succes" annonce="status">
          <p>{succes}</p>
        </Alerte>
      ) : null}

      {partage ? (
        <Alerte
          tonalite="succes"
          titre={t("Plan partagé au client", "Plan shared with the client")}
          annonce="aucune"
        >
          <p>
            {partageLe
              ? t(
                  `Partagé le ${formaterDateHeure(partageLe)}. `,
                  `Shared on ${formaterDateHeure(partageLe, undefined, langue)}. `,
                )
              : ""}
            {t(
              "Le partage autorise la diffusion au client du contenu validé et du modèle financier validé de ce plan.",
              "Sharing allows the approved content and approved financial model of this plan to be distributed to the client.",
            )}
          </p>
        </Alerte>
      ) : manques.length > 0 ? (
        <Alerte
          tonalite="info"
          titre={t("Partage impossible pour l'instant", "Sharing not possible yet")}
          annonce="aucune"
        >
          <p>
            {t(
              "Rien n'est partagé au client par défaut. Avant tout partage, chaque contenu doit être validé par un responsable de la mission. Il manque :",
              "Nothing is shared with the client by default. Before any sharing, each item must be approved by an engagement lead. Missing:",
            )}
          </p>
          <ul className="mp-plan__liste-manques">
            {manques.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </Alerte>
      ) : (
        <Alerte
          tonalite="info"
          titre={t("Prêt pour le client", "Ready for the client")}
          annonce="aucune"
        >
          <p>
            {t(
              "Tout le contenu est validé : le plan peut être partagé au client. Rien n'est partagé tant qu'un responsable ne l'a pas décidé.",
              "All content is approved: the plan can be shared with the client. Nothing is shared until a lead decides to.",
            )}
          </p>
        </Alerte>
      )}

      {peutPartager && partage ? (
        <div className="mp-barre-actions">
          <BoutonConfirmation
            libelle={t("Retirer le partage", "Withdraw sharing")}
            question={t(
              "Retirer le partage ? Le plan ne sera plus diffusable au client.",
              "Withdraw sharing? The plan will no longer be distributable to the client.",
            )}
            libelleConfirmation={t("Oui, retirer", "Yes, withdraw")}
            texteChargement={t("Retrait…", "Withdrawing…")}
            icone="cadenas"
            action={() => basculer(false)}
          />
        </div>
      ) : null}
      {peutPartager && !partage && manques.length === 0 ? (
        <div className="mp-barre-actions">
          <BoutonConfirmation
            libelle={t("Partager au client", "Share with the client")}
            question={t(
              "Partager ce plan au client ? Le contenu validé et le modèle financier validé lui deviennent diffusables. Toute modification ultérieure retirera ce partage.",
              "Share this plan with the client? The approved content and approved financial model become distributable to them. Any later change will withdraw this sharing.",
            )}
            libelleConfirmation={t("Oui, partager", "Yes, share")}
            texteChargement={t("Partage…", "Sharing…")}
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
