"use client";

import { useRouter } from "next/navigation";
import { useT, useLangue } from "../../../../components/i18n/FournisseurLangue";
import { RetourFormulaire } from "../../../../components/formulaires/RetourFormulaire";
import { useFormulaire } from "../../../../components/formulaires/useFormulaire";
import { Bouton } from "../../../../components/ui/Bouton";
import { api } from "../../../../lib/api";
import { messageQuestionnaire, type VersionDetail } from "../../../../lib/questionnaires";

/**
 * Nouvelle version brouillon d'un modèle, copie de la dernière version (l'API refuse s'il y a
 * déjà un brouillon : 409). Ouvre l'éditeur de la version créée.
 */
export function NouvelleVersion({ modeleId, prochaine }: { modeleId: string; prochaine: number }) {
  const t = useT();
  const langue = useLangue();
  const router = useRouter();
  const f = useFormulaire<never>();
  return (
    <div className="mp-pile">
      <div>
        <Bouton
          icone="plus"
          chargement={f.enCours}
          texteChargement={t("Création de la version…", "Creating the version…")}
          onClick={() =>
            void f.envoyer(
              { ok: true, charge: {} },
              (c) =>
                api.post<VersionDetail>(
                  `/api/questionnaires/modeles/${encodeURIComponent(modeleId)}/versions`,
                  c,
                ),
              {
                rafraichir: false,
                messageSpecifique: (e) => messageQuestionnaire(e, langue),
                apres: (v) => router.push(`/questionnaires/versions/${v.id}`),
              },
            )
          }
        >
          {t(`Créer la version ${prochaine}`, `Create version ${prochaine}`)}
        </Bouton>
      </div>
      <RetourFormulaire
        erreur={f.erreurGlobale}
        refAlerte={f.refAlerte}
        titreErreur={t("Création de la version impossible", "Version creation impossible")}
      />
    </div>
  );
}
