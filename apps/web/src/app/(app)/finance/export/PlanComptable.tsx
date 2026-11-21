"use client";

import { useState, type FormEvent } from "react";
import { RetourFormulaire } from "../../../../components/formulaires/RetourFormulaire";
import { useAttenteRafraichissement } from "../../../../components/formulaires/useAttenteRafraichissement";
import { useFormulaire } from "../../../../components/formulaires/useFormulaire";
import { Alerte } from "../../../../components/ui/Alerte";
import { Bouton } from "../../../../components/ui/Bouton";
import { CaseACocher } from "../../../../components/ui/CaseACocher";
import { Carte } from "../../../../components/ui/Carte";
import { Champ } from "../../../../components/ui/Champ";
import { useLangue, useT } from "../../../../components/i18n/FournisseurLangue";
import { api } from "../../../../lib/api";
import {
  libelleJournal,
  validerPlan,
  type PlanComptable as Plan,
  type SaisiePlan,
} from "../../../../lib/export-comptable";

const saisieDepuis = (p: Plan): SaisiePlan => ({
  comptes: Object.fromEntries(p.comptes.map((c) => [c.cle, c.compte])),
  journaux: Object.fromEntries(p.journaux.map((j) => [j.cle, j.code])),
  valeurs_validees: p.valeurs_validees,
});

/** Plan comptable du cabinet (comptes SYSCOHADA de départ, modifiables) et codes journaux. */
export function PlanComptable({ plan: p }: { plan: Plan }) {
  const t = useT();
  const langue = useLangue();
  const cle = JSON.stringify(saisieDepuis(p));
  const [s, setS] = useState<SaisiePlan>(() => saisieDepuis(p));
  const [info, setInfo] = useState<string | null>(null);
  const form = useFormulaire<string>();
  const [attente, marquer] = useAttenteRafraichissement(cle);

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    setInfo(null);
    const v = validerPlan(s, p, langue);
    if (v.ok && v.inchange) {
      setInfo(t("Aucune modification à enregistrer.", "No changes to save."));
      return;
    }
    await form.envoyer(v, (c) => api.patch("/api/finance/plan-comptable", c), {
      succes: t("Plan comptable enregistré.", "Chart of accounts saved."),
      apres: marquer,
    });
  }

  return (
    <Carte titre={t("Plan comptable du cabinet", "Firm's chart of accounts")}>
      <form
        ref={form.refFormulaire}
        className="mp-formulaire"
        noValidate
        onSubmit={soumettre}
        aria-label={t("Plan comptable du cabinet", "Firm's chart of accounts")}
      >
        {p.valeurs_validees ? (
          <Alerte
            tonalite="succes"
            annonce="aucune"
            titre={t("Plan validé par le cabinet", "Chart approved by the firm")}
          >
            <p>
              {t(
                "Les comptes ont été confirmés par l'expert-comptable du cabinet.",
                "The accounts were confirmed by the firm's chartered accountant.",
              )}
            </p>
          </Alerte>
        ) : (
          <Alerte
            tonalite="attention"
            annonce="aucune"
            titre={t(
              "Valeurs de départ à valider par un expert-comptable",
              "Starting values to be approved by a chartered accountant",
            )}
          >
            <p>
              {t(
                "Comptes proposés selon le SYSCOHADA révisé. Faites-les vérifier par l'expert-comptable du cabinet (notamment les débours refacturés et les retenues à la source), puis cochez « Plan validé ».",
                'Accounts proposed according to the revised SYSCOHADA. Have them checked by the firm\'s chartered accountant (in particular re-billed expenses and withholding taxes), then tick "Chart approved".',
              )}
            </p>
          </Alerte>
        )}
        <RetourFormulaire
          erreur={form.erreurGlobale}
          succes={form.succes ?? info}
          refAlerte={form.refAlerte}
        />
        <fieldset className="mp-groupe">
          <legend className="mp-champ__libelle">{t("Comptes", "Accounts")}</legend>
          <p className="mp-texte-doux">
            {t(
              "Numéro de compte utilisé dans chaque écriture exportée.",
              "Account number used in each exported entry.",
            )}
          </p>
          <div className="mp-grille-champs mp-grille-champs--serree mp-grille-champs--bas">
            {p.comptes.map((c) => (
              <Champ
                key={c.cle}
                libelle={c.libelle}
                aide={t(
                  `Valeur de départ : ${c.valeur_de_depart}`,
                  `Starting value: ${c.valeur_de_depart}`,
                )}
                autoCapitalize="characters"
                maxLength={12}
                value={s.comptes[c.cle] ?? ""}
                onChange={(e) =>
                  setS((x) => ({ ...x, comptes: { ...x.comptes, [c.cle]: e.target.value } }))
                }
                erreur={form.erreurs[`compte_${c.cle}`]}
              />
            ))}
          </div>
        </fieldset>
        <fieldset className="mp-groupe">
          <legend className="mp-champ__libelle">{t("Codes journaux", "Journal codes")}</legend>
          <div className="mp-grille-champs mp-grille-champs--serree mp-grille-champs--bas">
            {p.journaux.map((j) => (
              <Champ
                key={j.cle}
                libelle={libelleJournal(j.cle, langue)}
                aide={t(
                  `Valeur de départ : ${j.valeur_de_depart}`,
                  `Starting value: ${j.valeur_de_depart}`,
                )}
                autoCapitalize="characters"
                maxLength={6}
                value={s.journaux[j.cle] ?? ""}
                onChange={(e) =>
                  setS((x) => ({ ...x, journaux: { ...x.journaux, [j.cle]: e.target.value } }))
                }
                erreur={form.erreurs[`journal_${j.cle}`]}
              />
            ))}
          </div>
        </fieldset>
        <CaseACocher
          libelle={t(
            "Plan validé par l'expert-comptable du cabinet",
            "Chart approved by the firm's chartered accountant",
          )}
          checked={s.valeurs_validees}
          onChange={(e) => setS((x) => ({ ...x, valeurs_validees: e.target.checked }))}
        />
        <div className="mp-actions-formulaire">
          <Bouton
            type="submit"
            chargement={form.enCours || attente}
            texteChargement={t("Enregistrement…", "Saving…")}
          >
            {t("Enregistrer le plan comptable", "Save the chart of accounts")}
          </Bouton>
        </div>
      </form>
    </Carte>
  );
}
