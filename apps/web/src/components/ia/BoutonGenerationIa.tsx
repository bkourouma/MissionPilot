"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import { estPlafondAtteint, messageErreurIa } from "../../lib/ia";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { corpsGeneration, type DemandeGenerationIa, type GenerationIa } from "../../lib/ia-contenu";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import "./ia.css";

export interface BoutonGenerationIaProps {
  /**
   * Essai d'un prompt « exemple » (POST /api/ia/generations) : la demande, ou une fonction qui la
   * prépare (null : saisie invalide, rien n'est envoyé).
   */
  demande?: DemandeGenerationIa | (() => DemandeGenerationIa | null);
  /**
   * Génération par un service de conseil (sa propre route, qui fournit chiffres et sources) :
   * renvoie la génération créée, ou null si rien n'a été envoyé. `repli` : produire avec le
   * gabarit (plafond mensuel atteint). Prioritaire sur `demande`.
   */
  lancer?: (repli: boolean) => Promise<GenerationIa | null>;
  /** Reçoit la génération créée (202 en file, 201 immédiate) : l'afficher dans un PanneauContenuIa. */
  onGeneree: (g: GenerationIa) => void;
  libelle?: string;
  desactive?: boolean;
  /** Texte sous le bouton ; par défaut, rappel que le résultat est un brouillon à valider. */
  aide?: string;
}

const AIDE_DEFAUT =
  "Le texte produit sera un brouillon : relisez-le et validez-le avant tout envoi au client.";
const AIDE_DEFAUT_EN =
  "The text produced will be a draft: review and approve it before anything is sent to the client.";

/**
 * Lance une génération (essai en file par défaut, ou route d'un service). Plafond mensuel
 * atteint : propose de produire le contenu avec le gabarit (`repli_si_plafond`). Le corps n'emporte
 * jamais de chiffres : ils viennent des moteurs, côté serveur.
 */
export function BoutonGenerationIa({
  demande,
  lancer: lancerService,
  onGeneree,
  libelle,
  desactive,
  aide,
}: BoutonGenerationIaProps) {
  const t = useT();
  const langue = useLangue();
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<{ texte: string; plafond: boolean } | null>(null);
  const refAlerte = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (erreur) refAlerte.current?.focus();
  }, [erreur]);

  /** Essai : corps préparé (null si la saisie est refusée), envoyé à la route de test. */
  function appelEssai(repli: boolean): (() => Promise<GenerationIa>) | null {
    const d = typeof demande === "function" ? demande() : demande;
    if (!d) return null;
    const corps = corpsGeneration({ ...d, repli_si_plafond: repli || d.repli_si_plafond });
    return () => api.post<GenerationIa>("/api/ia/generations", corps);
  }

  async function lancer(repli: boolean) {
    const appel = lancerService ? () => lancerService(repli) : appelEssai(repli);
    if (!appel) return;
    setEnCours(true);
    setErreur(null);
    try {
      const g = await appel();
      if (g) onGeneree(g);
    } catch (e) {
      setErreur({ texte: messageErreurIa(e, langue), plafond: !repli && estPlafondAtteint(e) });
    } finally {
      setEnCours(false);
    }
  }

  return (
    <div className="mp-generation-ia">
      {erreur ? (
        <Alerte
          ref={refAlerte}
          tonalite={erreur.plafond ? "attention" : "danger"}
          titre={t("Génération impossible", "Generation not possible")}
        >
          <p>{erreur.texte}</p>
          {erreur.plafond ? (
            <p>
              <Bouton
                variante="secondaire"
                chargement={enCours}
                texteChargement={t("Envoi…", "Sending…")}
                onClick={() => void lancer(true)}
              >
                {t("Produire avec le gabarit", "Produce with the template")}
              </Bouton>
            </p>
          ) : null}
        </Alerte>
      ) : null}
      <Bouton
        icone="plus"
        chargement={enCours}
        texteChargement={t("Envoi de la demande…", "Sending the request…")}
        disabled={desactive}
        onClick={() => void lancer(false)}
      >
        {libelle ?? t("Générer un brouillon", "Generate a draft")}
      </Bouton>
      {(aide ?? t(AIDE_DEFAUT, AIDE_DEFAUT_EN)) !== "" ? (
        <p className="mp-champ__aide">{aide ?? t(AIDE_DEFAUT, AIDE_DEFAUT_EN)}</p>
      ) : null}
    </div>
  );
}
